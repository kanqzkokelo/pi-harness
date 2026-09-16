import { mkdtempSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { openStore } from '../state-graph/store.ts';
import { commitNode, worktreeAdd, worktreeRemove, currentSha, diffSize } from '../state-graph/gitops.ts';
import type { StateNode, BranchId } from '../state-graph/nodes.ts';
import { emptyResults, zeroCost, ACCEPT } from '../state-graph/nodes.ts';
import { verify } from '../verifier/run.ts';
import { rank, anyAccepts } from '../verifier/select.ts';
import type { FrozenTest } from '../verifier/freeze.ts';
import { STRATS } from './promptsABC.ts';

export type Strategy = (dir: string) => void | Promise<void>;
export interface BeamOpts {
  repoDir: string; dbPath?: string; suiteCmd?: string;
  strategies: Record<'A' | 'B' | 'C', Strategy>;
  retryStrategies?: Record<'A' | 'B' | 'C', Strategy>;
  subtasks?: StateNode['subtasks'];
  /** Early-stop: halt phase once a branch meets ACCEPT. Default true. */
  earlyStop?: boolean;
  /** Hard token cap: stop spawning when spent() >= tokenBudget. */
  tokenBudget?: number;
  spent?: () => number;
}
/**
 * Controlled beam: P1 A/B/C from SAME parent S0 -> verify -> rank.
 * P2 triggers iff NO branch meets ACCEPT (fail OR frozen-pass-but-inferior).
 */
export async function runBeam(frozen: FrozenTest[], opts: BeamOpts) {
  const { repoDir, suiteCmd } = opts;
  const store = openStore(opts.dbPath ?? join(repoDir, '.pi-harness-state.db'));
  const t0 = Date.now();
  const parentSha = currentSha(repoDir);
  const parentRate = 1; // baseline: suite must not regress vs green; caller may override
  const mk = async (phase: string, branch: BranchId, fn: Strategy): Promise<{ node: StateNode; diff: number }> => {
    const wt = mkdtempSync(join(tmpdir(), `beam-${phase}${branch}-`));
    const started = Date.now();
    try {
      worktreeAdd(repoDir, wt, `beam-${phase}${branch}`, parentSha);
      const localFrozen = frozen.map((f) => {
        const name = basename(f.path);
        const dest = join(wt, name);
        if (f.path !== dest && existsSync(f.path)) { copyFileSync(f.path, dest); try { copyFileSync(f.path + '.sha256', dest + '.sha256'); } catch { /* no lock file */ } }
        return { path: dest, sha: f.sha };
      });
      await fn(wt);
      const sha = commitNode(wt, `beam ${phase}${branch}: ${STRATS[branch]}`);
      const v = verify(wt, localFrozen, suiteCmd);
      const node: StateNode = {
        id: sha, parent_id: parentSha, branch_id: branch, snapshot_ref: `${sha}@${wt}`,
        subtasks: opts.subtasks ?? [], facts: [`phase=${phase}`, `strategy=${STRATS[branch]}`], actions: [],
        test_results: { frozen_pass: v.frozen_pass, suite_pass_rate: v.suite_pass_rate, lint: v.lint },
        cost: { ...zeroCost(), ms: Date.now() - started, tool_calls: 1 },
      };
      void emptyResults;
      store.put(node);
      store.link({ from: parentSha, to: sha, reason: `beam-${phase}${branch}` });
      return { node, diff: diffSize(repoDir, parentSha, sha) };
    } finally { worktreeRemove(repoDir, wt); }
  };
  const earlyStop = opts.earlyStop ?? true;
  const overBudget = () => opts.tokenBudget !== undefined && opts.spent !== undefined && opts.spent() >= opts.tokenBudget;
  const runPhase = async (phase: string, strats: Record<'A' | 'B' | 'C', Strategy>): Promise<{ node: StateNode; diff: number }[]> => {
    const out: { node: StateNode; diff: number }[] = [];
    for (const b of ['A', 'B', 'C'] as BranchId[]) {
      if (overBudget()) break;
      const r = await mk(phase, b, strats[b]);
      out.push(r);
      if (earlyStop && ACCEPT(r.node, parentRate)) break;
    }
    return out;
  };
  const p1 = await runPhase('P1', opts.strategies);
  let ranked = rank(p1);
  let tried = 1;
  if (p1.length > 0 && !anyAccepts(ranked, parentRate) && opts.retryStrategies && !overBudget()) {
    const p2 = await runPhase('P2', opts.retryStrategies);
    ranked = rank([...p1, ...p2]);
    tried = 2;
  }
  const best = ranked[0];
  if (!best) throw new Error('beam: no branches ran (budget exhausted before P1)');
  const ms = Date.now() - t0;
  store.close();
  void diffSize;
  return { best, ranked, rounds: tried, ms, parentSha };
}
