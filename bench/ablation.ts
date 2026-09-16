import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
export type Arm = 'stock' | 'beam-only' | 'frozen-only' | 'beam+frozen';
export interface Trial { instance: string; arm: Arm; pass: boolean; tokens: number; ms: number; tool_calls: number }
/**
 * 4-arm ablation: (1)stock Pi (2)beam-only (3)frozen-only (4)beam+frozen.
 * Same T0 tests / image / seed per instance. H0: (4) !> (1). Ship iff +4pp & <=2x.
 * Executor injected per arm by caller; this file only records + summarizes.
 */
export function record(outDir: string, t: Trial) {
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, 'trials.jsonl'), JSON.stringify(t) + '\n');
}
export function summarize(trials: Trial[]): string {
  const arms: Arm[] = ['stock', 'beam-only', 'frozen-only', 'beam+frozen'];
  return arms.map((a) => {
    const ts = trials.filter((t) => t.arm === a);
    const p = ts.length ? ts.filter((t) => t.pass).length / ts.length : 0;
    const tok = ts.reduce((s, t) => s + t.tokens, 0);
    return `${a}: n=${ts.length} pass@1=${(p * 100).toFixed(1)}% tokens=${tok}`;
  }).join('\n');
}
console.log('ablation runner ready: stock vs beam-only vs frozen-only vs beam+frozen');
