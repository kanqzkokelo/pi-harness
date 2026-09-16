import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../state-graph/store.ts';
import { commitNode, worktreeAdd, worktreeRemove, currentSha, diffSize } from '../state-graph/gitops.ts';
import type { StateNode, BranchId } from '../state-graph/nodes.ts';
import { emptyResults, zeroCost } from '../state-graph/nodes.ts';
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
      await fn(wt);
      const sha = commitNode(wt, `beam ${phase}${branch}: ${STRATS[branch]}`);
      const v = verify(wt, frozen.map((f) => ({ ...f, path: join(wt, f.path.split('/').pop()!) })), suiteCmd);
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
  const p1 = [await mk('P1', 'A', opts.strategies.A), await mk('P1', 'B', opts.strategies.B), await mk('P1', 'C', opts.strategies.C)];
  let ranked = rank(p1);
  let tried = 1;
  if (!anyAccepts(ranked, parentRate) && opts.retryStrategies) {
    const p2 = [await mk('P2', 'A', opts.retryStrategies.A), await mk('P2', 'B', opts.retryStrategies.B), await mk('P2', 'C', opts.retryStrategies.C)];
    ranked = rank([...p1, ...p2]);
    tried = 2;
  }
  const best = ranked[0];
  const ms = Date.now() - t0;
  store.close();
  void diffSize;
  return { best, ranked, rounds: tried, ms, parentSha };
}
