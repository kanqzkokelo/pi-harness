import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface FrozenTest { path: string; sha: string }
/**
 * T0 TEST/SPEC CONSTRUCTION — NOT a verifier.
 * Writes repro test file pre-fix, returns sha lock. Verifier (run.ts) executes.
 * Taint check: any post-lock modification fails branch.
 */
export function freezeTest(repoDir: string, filename: string, src: string): FrozenTest {
  const path = join(repoDir, filename);
  writeFileSync(path, src);
  const sha = createHash('sha256').update(src).digest('hex');
  writeFileSync(path + '.sha256', sha);
  return { path, sha };
}
export function verifyIntact(t: FrozenTest): boolean {
  if (!existsSync(t.path) || !existsSync(t.path + '.sha256')) return false;
  const cur = createHash('sha256').update(readFileSync(t.path)).digest('hex');
  const locked = readFileSync(t.path + '.sha256', 'utf8').trim();
  return cur === locked && cur === t.sha;
}
