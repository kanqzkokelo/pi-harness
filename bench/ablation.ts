import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Arm = 'stock' | 'beam-only' | 'frozen-only' | 'beam+frozen';
export const ARMS: Arm[] = ['stock', 'beam-only', 'frozen-only', 'beam+frozen'];

/** Frozen artifact pinned per task. Same bytes+sha for all arms. */
export interface FrozenArtifact { path: string; sha: string }
/** One task, fully pinned. All arms share identical fields. */
export interface TaskDef {
  id: string; repoDir: string; base_commit: string;
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

/** Manifest-driven: every arm gets same task def (commit, frozen, model, env, budget). */
export async function runAblation(manifest: Manifest, executors: Record<Arm, Executor>, outDir: string): Promise<{ trials: Trial[]; deltas: TaskDelta[] }> {
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
