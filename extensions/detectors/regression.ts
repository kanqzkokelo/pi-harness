/** Regression: suite rate drops >5pp vs parent -> rollback, kill branch. */
export function regressed(parentRate: number, branchRate: number, pp = 0.05): boolean {
  return branchRate < parentRate - pp;
}
