/** Premature-stop: claims done but frozen failed -> reject, rollback. */
export function prematureStop(claimedDone: boolean, frozenPass: boolean): boolean {
  return claimedDone && !frozenPass;
}
