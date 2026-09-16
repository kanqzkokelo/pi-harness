import { createHash } from 'node:crypto';
/** Loop: same tool+args hash 3x -> force next branch. */
export function loopHit(history: { tool: string; args: string }[]): boolean {
  if (history.length < 3) return false;
  const h = (x: { tool: string; args: string }) => createHash('sha256').update(x.tool + x.args).digest('hex');
  const last3 = history.slice(-3).map(h);
  return last3[0] === last3[1] && last3[1] === last3[2];
}
