import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { runAblation, type TaskDef, type Executor } from '../ablation.ts';
import { verify } from '../../extensions/verifier/run.ts';
import { runBeam } from '../../extensions/branch/beam.ts';
import { buildPilot } from './tasks.ts';

const MODEL_FLAG = 'opencode/muse-spark-1.3-contributor-free';

/** One non-interactive model call inside dir. Returns stdout tail + totalTokens. */
function piCall(dir: string, prompt: string, timeoutMs = 300000): { out: string; tokens: number } {
  const t0 = Date.now();
  let raw = '';
  try {
    raw = execSync(`pi -p --no-session --mode json --model ${MODEL_FLAG} -- ${JSON.stringify(prompt)}`, {
      cwd: dir, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PI_APPROVE: '1' },
    });
  } catch (e: any) { raw = String(e?.stdout ?? '') + String(e?.message ?? ''); }
  const toks = [...raw.matchAll(/"totalTokens":(\d+)/g)].map((m) => Number(m[1]));
  void t0;
  return { out: raw.slice(-2000), tokens: toks.length ? toks[toks.length - 1] : 0 };
}

const freshClone = (t: TaskDef): string => {
  const d = mkdtempSync(join(tmpdir(), `arm-${t.id}-`));
  execFileSync('git', ['clone', '-q', t.repoDir, d + '-c'], { stdio: 'pipe' });
  const c = d + '-c';
  execFileSync('git', ['checkout', '-q', t.base_commit], { cwd: c, stdio: 'pipe' });
  return c;
};

const STRAT_PROMPT = (brief: string, s: string) =>
  `Fix the bug in this repo by editing files directly. Bug: ${brief} Strategy: ${s}. Keep changes minimal. Do not modify test files. When done, stop.`;

const passOf = (dir: string, t: TaskDef): boolean => {
  const name = basename(t.frozen.path);
  const v = verify(dir, [{ path: join(dir, name), sha: t.frozen.sha }], 'true');
  return v.frozen_pass && v.lint;
};

export async function main() {
  const root = join(process.cwd(), 'bench', 'pilot', 'tasks');
  const { manifestTasks, briefs } = buildPilot(root);
  const mkExec = (fn: (t: TaskDef) => Promise<{ pass: boolean; tokens: number; ms: number; tool_calls: number }>): Executor => fn;

  const stock: Executor = mkExec(async (t) => {
    const d = freshClone(t); const t0 = Date.now(); let calls = 0;
    const r = piCall(d, `Fix the bug in this repo by editing files directly. Bug: ${briefs[t.id]} Keep changes minimal. Do not modify test files.`);
    calls++;
    return { pass: passOf(d, t), tokens: r.tokens, ms: Date.now() - t0, tool_calls: calls };
  });

  const beamOnly: Executor = mkExec(async (t) => {
    const t0 = Date.now(); let tokens = 0, calls = 0;
    const strat = ['minimal patch, smallest diff', 'alternate approach, rewrite function body', 'repro-driven, handle edge cases first'];
    let best = false;
    for (const s of strat) {
      const d = freshClone(t);
      const r = piCall(d, STRAT_PROMPT(briefs[t.id], s)); tokens += r.tokens; calls++;
      try {
        execSync('python3 -m pytest test_dev.py -q --tb=line', { cwd: d, stdio: 'pipe' });
        if (passOf(d, t)) best = true;
      } catch { if (passOf(d, t)) best = true; }
    }
    return { pass: best, tokens, ms: Date.now() - t0, tool_calls: calls };
  });

  const frozenOnly: Executor = mkExec(async (t) => {
    const d = freshClone(t); const t0 = Date.now();
    const r = piCall(d, `Fix the bug in this repo by editing files directly. Bug: ${briefs[t.id]} The hidden acceptance test checks exact spec compliance including edge cases. Do not modify test files.`);
    return { pass: passOf(d, t), tokens: r.tokens, ms: Date.now() - t0, tool_calls: 1 };
  });

  const beamFrozen: Executor = mkExec(async (t) => {
    const t0 = Date.now(); let tokens = 0, calls = 0;
    const strat = (s: string) => async (dir: string) => {
      const r = piCall(dir, STRAT_PROMPT(briefs[t.id], s)); tokens += r.tokens; calls++;
    };
    // Seed worktree content: runBeam clones from repoDir at base via worktrees; simpler: temp git repo copy
    const work = freshClone(t);
    execFileSync('git', ['config', 'user.email', 'p@p'], { cwd: work }); execFileSync('git', ['config', 'user.name', 'p'], { cwd: work });
    const frozen = [{ path: join(work, basename(t.frozen.path)), sha: t.frozen.sha }];
    const res = await runBeam(frozen, {
      repoDir: work, suiteCmd: 'true',
      parentSuitePassRate: verify(work, frozen, 'true').suite_pass_rate,
      strategies: { A: strat('minimal patch'), B: strat('alternate approach'), C: strat('edge cases first') },
    });
    return { pass: res.best.test_results.frozen_pass, tokens, ms: Date.now() - t0, tool_calls: calls };
  });

  const out = join(process.cwd(), 'bench', 'pilot', 'out');
  const { trials, deltas } = await runAblation({ tasks: manifestTasks }, { stock, 'beam-only': beamOnly, 'frozen-only': frozenOnly, 'beam+frozen': beamFrozen }, out);
  console.log(trials.map((x) => `${x.instance}/${x.arm}: pass=${x.pass} tok=${x.tokens} calls=${x.tool_calls}`).join('\n'));
  console.log(JSON.stringify(deltas, null, 1));
}

main().catch((e) => { console.error('PILOT FAIL', e); process.exit(1); });
