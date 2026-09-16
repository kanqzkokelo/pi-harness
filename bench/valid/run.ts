import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { ACCEPT } from '../../extensions/state-graph/nodes.ts';
import { runAblation, type TaskDef, type Executor, type Arm } from '../ablation.ts';
import { verify } from '../../extensions/verifier/run.ts';
import { frozenRel } from '../../extensions/verifier/freeze.ts';
import { runBeam } from '../../extensions/branch/beam.ts';
import { buildTasks } from '../pilot/tasks.ts';
import { VALID_SEEDS } from './seeds.ts';
import { basePrompt, strategyPrompt, assertPromptParity, BEAM_STRATEGIES } from './prompts.ts';

const MODEL_FLAG = 'opencode/muse-spark-1.3-contributor-free';
/** Per-task cap = 2× measured stock tokens (stock arm always runs first per task).
 *  Same unit everywhere: pi --mode json `totalTokens`, single extractor piCall. */
const FALLBACK_BUDGET = 45000;
const stockTok: Record<string, number> = {};
/** Zero-token stock = failed measurement, not free lunch: fall back, never cap at 0. */
const capOf = (t: TaskDef): { tokenBudget: number; estBranch: number } => {
  const s = stockTok[t.id] ?? 0;
  return s > 0 ? { tokenBudget: s * 2, estBranch: s } : { tokenBudget: FALLBACK_BUDGET, estBranch: 20000 };
};

function piCall(dir: string, prompt: string, timeoutMs = 300000, retries = 2): { out: string; tokens: number } {
  let raw = '';
  for (let a = 0; a <= retries; a++) {
    try {
      raw = execSync(`pi -p --no-session --mode json --model ${MODEL_FLAG} -- ${JSON.stringify(prompt)}`, {
        cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, PI_APPROVE: '1' },
      });
    } catch (e: any) { raw = String(e?.stdout ?? '') + String(e?.message ?? ''); }
    const toks = [...raw.matchAll(/"totalTokens":(\d+)/g)].map((m) => Number(m[1]));
    const n = toks.length ? toks[toks.length - 1] : 0;
    if (n > 0 || a === retries) return { out: raw.slice(-2000), tokens: n };
    execSync('sleep 60'); // rate-limit backoff, then retry
  }
  return { out: raw.slice(-2000), tokens: 0 };
}

const freshClone = (t: TaskDef): string => {
  const d = mkdtempSync(join(tmpdir(), `arm-${t.id}-`));
  execFileSync('git', ['clone', '-q', t.repoDir, d + '-c'], { stdio: 'pipe' });
  const c = d + '-c';
  execFileSync('git', ['checkout', '-q', t.base_commit], { cwd: c, stdio: 'pipe' });
  return c;
};

/** Frozen path preserved relative to the clone root (F4). */
const frozenIn = (cloneDir: string, t: TaskDef): { path: string; sha: string } => {
  const rel = frozenRel(t.repoDir, t.frozen.path);
  return { path: join(cloneDir, rel), sha: t.frozen.sha };
};

const passOf = (dir: string, t: TaskDef, parentRate: number): boolean => {
  const f = frozenIn(dir, t);
  const v = verify(dir, [f], 'true');
  // Same criterion for every arm (mirrors ACCEPT): frozen + lint + no regression.
  return v.frozen_pass && v.lint && v.suite_pass_rate >= parentRate;
};
const devPass = (dir: string): boolean => {
  try { execSync('python3 -m pytest test_dev.py -q --tb=line', { cwd: dir, stdio: 'pipe' }); return true; }
  catch { return false; }
};

/** Parent rate measured once per task with the same verifier machinery.
 *  (With suiteCmd 'true' the regression dimension is vacuous here; the
 *  dimension itself is covered by unit tests + beam ACCEPT logic.) */
const parentRates: Record<string, number> = {};
const parentOf = (t: TaskDef): number => {
  if (parentRates[t.id] === undefined) {
    const d = freshClone(t);
    parentRates[t.id] = verify(d, [frozenIn(d, t)], 'true').suite_pass_rate;
  }
  return parentRates[t.id];
};

/** Prompts actually handed to the model, per arm. Preflight asserts
 *  stock === frozen-only; beam arms share base + fixed strategy set. */
export const promptsForArm: Record<Arm, (t: TaskDef) => string> = {
  stock: (t) => basePrompt(t.brief),
  'frozen-only': (t) => basePrompt(t.brief),
  'beam-only': (t) => strategyPrompt(t.brief, BEAM_STRATEGIES[0]),
  'beam+frozen': (t) => strategyPrompt(t.brief, BEAM_STRATEGIES[0]),
};

export async function main() {
  const quickN = Number(process.env.QUICK_N ?? 0);
  const seeds = quickN > 0 ? VALID_SEEDS.slice(0, quickN) : VALID_SEEDS;
  const root = join(process.cwd(), 'bench', 'valid', quickN > 0 ? 'quick' + quickN : 'tasks');
  const { manifestTasks } = buildTasks(root, seeds);
  for (const t of manifestTasks) assertPromptParity(t.brief);
  const mkExec = (fn: (t: TaskDef) => Promise<{ pass: boolean; tokens: number; ms: number; tool_calls: number }>): Executor => fn;

  const stock: Executor = mkExec(async (t) => {
    const d = freshClone(t); const t0 = Date.now();
    const r = piCall(d, basePrompt(t.brief));
    stockTok[t.id] = r.tokens;
    return { pass: passOf(d, t, parentOf(t)), tokens: r.tokens, ms: Date.now() - t0, tool_calls: 1 };
  });

  const beamOnly: Executor = mkExec(async (t) => {
    const t0 = Date.now(); let tokens = 0, calls = 0, best = false;
    const cap = stockTok[t.id] > 0 ? stockTok[t.id] * 2 : FALLBACK_BUDGET;
    for (const s of BEAM_STRATEGIES) {
      if (tokens >= cap) break;
      const d = freshClone(t);
      const r = piCall(d, strategyPrompt(t.brief, s)); tokens += r.tokens; calls++;
      const dg = devPass(d);
      if (dg && passOf(d, t, parentOf(t))) best = true;
      if (dg) break; // early-stop control: stop on dev green
    }
    return { pass: best, tokens, ms: Date.now() - t0, tool_calls: calls };
  });

  const frozenOnly: Executor = mkExec(async (t) => {
    const d = freshClone(t); const t0 = Date.now();
    // Identical prompt to stock (F1). Harness executes frozen tests after;
    // the model receives no hint about hidden acceptance tests.
    const r = piCall(d, basePrompt(t.brief));
    return { pass: passOf(d, t, parentOf(t)), tokens: r.tokens, ms: Date.now() - t0, tool_calls: 1 };
  });

  const beamFrozen: Executor = mkExec(async (t) => {
    const t0 = Date.now(); let tokens = 0, calls = 0;
    const strat = (s: string) => async (dir: string) => {
      const r = piCall(dir, strategyPrompt(t.brief, s)); tokens += r.tokens; calls++;
      return { tokens: r.tokens, toolCalls: 1 };
    };
    const work = freshClone(t);
    execFileSync('git', ['config', 'user.email', 'p@p'], { cwd: work }); execFileSync('git', ['config', 'user.name', 'p'], { cwd: work });
    const f = frozenIn(work, t);
    // F2: parent rate measured with the same verifier machinery as candidates.
    const parent = verify(work, [f], 'true');
    const res = await runBeam([f], {
      repoDir: work, suiteCmd: 'true',
      parentSuitePassRate: parent.suite_pass_rate,
      ...(stockTok[t.id] !== undefined
        ? { ...capOf(t), spent: () => tokens }
        : { spent: () => tokens }),
      strategies: { A: strat(BEAM_STRATEGIES[0]), B: strat(BEAM_STRATEGIES[1]), C: strat(BEAM_STRATEGIES[2]) },
    });
    return { pass: ACCEPT(res.best, parent.suite_pass_rate), tokens, ms: Date.now() - t0, tool_calls: calls };
  });

  const out = join(process.cwd(), 'bench', 'valid', quickN > 0 ? 'quick' + quickN + '-out' : 'out');
  const { trials } = await runAblation({ tasks: manifestTasks }, { stock, 'beam-only': beamOnly, 'frozen-only': frozenOnly, 'beam+frozen': beamFrozen }, out, { prompts: promptsForArm });
  console.log(trials.map((x) => `${x.instance}/${x.arm}: pass=${x.pass} tok=${x.tokens} calls=${x.tool_calls}`).join('\n'));
}

main().catch((e) => { console.error('VALID FAIL', e); process.exit(1); });
