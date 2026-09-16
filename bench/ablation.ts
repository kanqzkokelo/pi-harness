import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Arm = 'stock' | 'beam-only' | 'frozen-only' | 'beam+frozen';
export const ARMS: Arm[] = ['stock', 'beam-only', 'frozen-only', 'beam+frozen'];

/** Frozen artifact pinned per task. Same bytes+sha for all arms. */
export interface FrozenArtifact { path: string; sha: string }
/** One task, fully pinned. All arms share this identical object. */
export interface TaskDef {
  id: string; repoDir: string; base_commit: string;
  /** Same user-visible bug description for every arm. */
  brief: string;
  frozen: FrozenArtifact; model: string; suiteCmd: string;
  token_budget: number; env: { image: string; seed: number };
}
export interface Manifest { tasks: TaskDef[] }
export interface Trial extends Record<string, unknown> {
  instance: string; arm: Arm; pass: boolean;
  tokens: number; ms: number; tool_calls: number;
  model: string; base_commit: string; frozen_sha: string; seed: number;
  /** Token unit proof: all arms share one extractor. */
  tok_unit: 'pi-totalTokens';
}
/** Per-task deltas vs stock. Machine-readable. */
export interface TaskDelta {
  task: string;
  stock_pass: boolean;
  deltas: Partial<Record<Exclude<Arm, 'stock'>, { d_pass: number; d_tokens: number; d_ms: number }>>;
}
export type Executor = (t: TaskDef) => Promise<{ pass: boolean; tokens: number; ms: number; tool_calls: number }>;

/** Preflight fairness gate: every task asserts identical arm inputs; arm behavior differs only via harness config. Writes machine-readable failure, aborts pre-trial on mismatch. */
export function preflight(manifest: Manifest, outDir: string, prompts?: Record<Arm, (t: TaskDef) => string>): void {
  const failures: Record<string, unknown>[] = [];
  if (manifest.tasks.length === 0) failures.push({ task: '*', field: 'tasks', issue: 'empty manifest' });
  for (const t of manifest.tasks) {
    const req: [string, unknown][] = [
      ['base_commit', t.base_commit], ['brief', t.brief], ['model', t.model],
      ['seed', t.env?.seed], ['image', t.env?.image], ['frozen.sha', t.frozen?.sha],
      ['frozen.path', t.frozen?.path], ['token_budget', t.token_budget], ['suiteCmd', t.suiteCmd],
    ];
    for (const [field, v] of req) {
      if (v === undefined || v === null || v === '' || v === 0) failures.push({ task: t.id, field, issue: 'missing-or-empty' });
    }
    if (prompts) {
      const missing = ARMS.filter((a) => typeof prompts[a] !== 'function');
      if (missing.length > 0) failures.push({ task: t.id, field: 'prompts', issue: 'missing arms: ' + missing.join(',') });
      else {
        const p = Object.fromEntries(ARMS.map((a) => [a, prompts[a](t)])) as Record<Arm, string>;
        if (p.stock !== p['frozen-only']) {
          failures.push({ task: t.id, field: 'prompt.stock-vs-frozen-only', issue: 'prompts differ', stock: p.stock, frozenOnly: p['frozen-only'] });
        }
      }
    }
  }
  if (failures.length > 0) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'preflight-fail.json'), JSON.stringify(failures, null, 2));
    throw new Error('preflight failed (' + failures.length + '): see ' + join(outDir, 'preflight-fail.json'));
  }
}

/** Manifest-driven: every arm gets same task def (commit, frozen, model, env, budget). */
export async function runAblation(manifest: Manifest, executors: Record<Arm, Executor>, outDir: string, opts: { prompts?: Record<Arm, (t: TaskDef) => string> } = {}): Promise<{ trials: Trial[]; deltas: TaskDelta[] }> {
  preflight(manifest, outDir, opts.prompts);
  mkdirSync(outDir, { recursive: true });
  const trials: Trial[] = [];
  for (const t of manifest.tasks) {
    for (const arm of ARMS) {
      const r = await executors[arm](t);
      const trial: Trial = { instance: t.id, arm, pass: r.pass, tokens: r.tokens, ms: r.ms, tool_calls: r.tool_calls, model: t.model, base_commit: t.base_commit, frozen_sha: t.frozen.sha, seed: t.env.seed, tok_unit: 'pi-totalTokens' };
      trials.push(trial);
      appendFileSync(join(outDir, 'trials.jsonl'), JSON.stringify(trial) + '\n');
    }
  }
  const deltas: TaskDelta[] = manifest.tasks.map((t) => {
    const by = (a: Arm) => trials.find((x) => x.instance === t.id && x.arm === a)!;
    const s = by('stock');
    const d = (a: Exclude<Arm, 'stock'>) => { const x = by(a); return { d_pass: Number(x.pass) - Number(s.pass), d_tokens: x.tokens - s.tokens, d_ms: x.ms - s.ms }; };
    return { task: t.id, stock_pass: s.pass, deltas: { 'beam-only': d('beam-only'), 'frozen-only': d('frozen-only'), 'beam+frozen': d('beam+frozen') } };
  });
  writeFileSync(join(outDir, 'deltas.json'), JSON.stringify(deltas, null, 2));
  writeFileSync(join(outDir, 'summary.txt'), summarize(trials));
  return { trials, deltas };
}

export function record(outDir: string, t: Trial) {
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, 'trials.jsonl'), JSON.stringify(t) + '\n');
}
export function summarize(trials: Trial[]): string {
  return ARMS.map((a) => {
    const ts = trials.filter((t) => t.arm === a);
    const p = ts.length ? ts.filter((t) => t.pass).length / ts.length : 0;
    const tok = ts.reduce((s, t) => s + t.tokens, 0);
    return `${a}: n=${ts.length} pass@1=${(p * 100).toFixed(1)}% tokens=${tok}`;
  }).join('\n');
}
