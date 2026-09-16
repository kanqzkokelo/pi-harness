import { ACCEPT, type StateNode } from '../state-graph/nodes.ts';

/** Deterministic rank: frozen desc, suite rate desc, diff asc. No LLM judge. */
export function rank(nodes: { node: StateNode; diff: number }[]): StateNode[] {
  return [...nodes]
    .sort((a, b) =>
      Number(b.node.test_results.frozen_pass) - Number(a.node.test_results.frozen_pass) ||
      b.node.test_results.suite_pass_rate - a.node.test_results.suite_pass_rate ||
      a.diff - b.diff)
    .map((x) => x.node);
}
export const anyAccepts = (ns: StateNode[], parentRate: number): boolean => ns.some((n) => ACCEPT(n, parentRate));
