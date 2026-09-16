import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../state-graph/store.ts';
import { commitNode, worktreeAdd, worktreeRemove, currentSha, diffSize } from '../state-graph/gitops.ts';
import type { StateNode, BranchId } from '../state-graph/nodes.ts';
import { zeroCost, ACCEPT } from '../state-graph/nodes.ts';
import { verify } from '../verifier/run.ts';
import { rank, anyAccepts } from '../verifier/select.ts';
import type { FrozenTest } from '../verifier/freeze.ts';
import { stageFrozen } from '../verifier/freeze.ts';
import { STRATS } from './promptsABC.ts';

/** What a strategy reports back. Tokens/calls must be real (metered by the
 *  executor); omitted only when the executor cannot meter (counts as 0). */
export interface StrategyReport { tokens: number; toolCalls?: number }
export type Strategy = (dir: string) => StrategyReport | void | Promise<StrategyReport | void>;
export interface BeamOpts {
  repoDir: string; dbPath?: string; suiteCmd?: string;
  strategies: Record<'A' | 'B' | 'C', Strategy>;
  retryStrategies?: Record<'A' | 'B' | 'C', Strategy>;
  subtasks?: StateNode['subtasks'];
  /** Parent suite pass rate, measured with the SAME verifier/test machinery
   *  as candidates. Required: no silent default (a hardcoded 1.0 would
   *  reject valid no-regression fixes on imperfect-green parents). */
  parentSuitePassRate: number;
  /** Early-stop: halt phase once a branch meets ACCEPT. Default true. */
  earlyStop?: boolean;
  /** Hard token cap: stop spawning when spent() >= tokenBudget. */
  tokenBudget?: number;
  spent?: () => number;
  /** Estimated next-branch cost: spawn iff spent()+estBranch <= tokenBudget.
   *  Without it, a ~20k branch can slip under a 45k cap and land at 62k. */
  estBranch?: number;
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
  const parentRate = opts.parentSuitePassRate;
  const mk = async (phase: string, branch: BranchId, fn: Strategy): Promise<{ node: StateNode; diff: number }> => {
    const wt = mkdtempSync(join(tmpdir(), `beam-${phase}${branch}-`));
    const started = Date.now();
    try {
      worktreeAdd(repoDir, wt, `beam-${phase}${branch}`, parentSha);
      const localFrozen = frozen.map((f) => stageFrozen(repoDir, wt, f));
      const rep = (await fn(wt)) ?? { tokens: 0 };
      const sha = commitNode(wt, `beam ${phase}${branch}: ${STRATS[branch]}`);
      const v = verify(wt, localFrozen, suiteCmd);
      const node: StateNode = {
        id: sha, parent_id: parentSha, branch_id: branch,
        // F6: persistent identity only. The worktree path is ephemeral
        // (removed below) and lives in runtime metadata, never as identity.
        snapshot_ref: `git:${sha}`,
        runtime: { worktree: wt },
        subtasks: opts.subtasks ?? [], facts: [`phase=${phase}`, `strategy=${STRATS[branch]}`],
        // actions intentionally empty in MVP (no tool-trace capture yet).
        // Branch cost below is real: executor-metered tokens/calls + measured ms.
        actions: [],
        test_results: { frozen_pass: v.frozen_pass, suite_pass_rate: v.suite_pass_rate, lint: v.lint },
        cost: { tokens: rep.tokens, tool_calls: rep.toolCalls ?? 0, ms: Date.now() - started },
      };
      void zeroCost;
      store.put(node);
      store.link({ from: parentSha, to: sha, reason: `beam-${phase}${branch}` });
      return { node, diff: diffSize(repoDir, parentSha, sha) };
    } finally { worktreeRemove(repoDir, wt); }
  };
  const earlyStop = opts.earlyStop ?? true;
  const overBudget = () => opts.tokenBudget !== undefined && opts.spent !== undefined && opts.spent() >= opts.tokenBudget;
  const overBudgetNext = () =>
    opts.tokenBudget !== undefined && opts.spent !== undefined &&
    opts.spent() + (opts.estBranch ?? 0) > opts.tokenBudget;
  const runPhase = async (phase: string, strats: Record<'A' | 'B' | 'C', Strategy>): Promise<{ node: StateNode; diff: number }[]> => {
    const out: { node: StateNode; diff: number }[] = [];
    for (const b of ['A', 'B', 'C'] as BranchId[]) {
      if (overBudget() || overBudgetNext()) break;
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
  return { best, ranked, rounds: tried, ms, parentSha };
}
