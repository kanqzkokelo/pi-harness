export type BranchId = 'A' | 'B' | 'C';
export type SubtaskStatus = 'todo' | 'doing' | 'done' | 'blocked';
export interface Subtask { id: string; title: string; status: SubtaskStatus }
export interface ActionRec { tool: string; args: string; result_hash: string; ts: number }
export interface TestResults { frozen_pass: boolean; suite_pass_rate: number; lint: boolean }
export interface Cost { tokens: number; tool_calls: number; ms: number }
export interface StateNode {
  id: string; // git sha
  parent_id: string | null;
  branch_id: BranchId;
  /** Persistent snapshot identity, e.g. `git:<sha>`. Never an ephemeral path. */
  snapshot_ref: string;
  /** Ephemeral runtime metadata (worktree dirs, containers). Not identity. */
  runtime?: { worktree?: string; container?: string };
  subtasks: Subtask[];
  facts: string[]; // append-only, tool-grounded
  actions: ActionRec[]; // MVP: intentionally empty (no tool-trace capture); cost.* is real
  test_results: TestResults;
  cost: Cost;
}
export interface Edge { from: string; to: string; reason: string }

/** Acceptance threshold: frozen must pass AND no suite regression vs parent AND lint clean. */
export const ACCEPT = (n: StateNode, parentRate: number): boolean =>
  n.test_results.frozen_pass &&
  n.test_results.suite_pass_rate >= parentRate &&
  n.test_results.lint;

export const emptyResults = (): TestResults => ({ frozen_pass: false, suite_pass_rate: 0, lint: false });
export const zeroCost = (): Cost => ({ tokens: 0, tool_calls: 0, ms: 0 });
export const addCost = (a: Cost, b: Partial<Cost>): Cost => ({
  tokens: a.tokens + (b.tokens ?? 0),
  tool_calls: a.tool_calls + (b.tool_calls ?? 0),
  ms: a.ms + (b.ms ?? 0),
});
