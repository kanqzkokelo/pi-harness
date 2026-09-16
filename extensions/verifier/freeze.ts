import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, relative, dirname, isAbsolute, sep } from 'node:path';

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

/** Path of a frozen test relative to its repo root. Rejects absolute paths
 *  and `..` escapes so a frozen artifact can never address outside the repo. */
export function frozenRel(repoRoot: string, frozenPath: string): string {
  const rel = relative(repoRoot, frozenPath);
  if (isAbsolute(rel) || rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`frozen path escapes repo: ${frozenPath}`);
  }
  return rel;
}

/** Stage a frozen test (plus its hash lock) into a target tree, preserving
 *  the repo-relative path. Prevents basename collisions such as
 *  tests/unit/test_bug.py vs tests/integration/test_bug.py. */
export function stageFrozen(repoRoot: string, destRoot: string, f: FrozenTest): FrozenTest {
  const rel = frozenRel(repoRoot, f.path);
  const dest = join(destRoot, rel);
  mkdirSync(dirname(dest), { recursive: true });
  if (f.path !== dest && existsSync(f.path)) {
    copyFileSync(f.path, dest);
    if (existsSync(f.path + '.sha256')) copyFileSync(f.path + '.sha256', dest + '.sha256');
  }
  return { path: dest, sha: f.sha };
}
