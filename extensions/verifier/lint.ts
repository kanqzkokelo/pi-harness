import { execFileSync } from 'node:child_process';

/** Syntax-check every tracked .py file. True when no .py files exist.
 *  (Never `py_compile <dir>`: that raises EISDIR and fails unconditionally.) */
export function lintRepo(repoDir: string): boolean {
  let files: string[];
  try {
    const out = execFileSync('git', ['ls-files', '-z', '*.py'], {
      cwd: repoDir, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'],
    }) as Buffer;
    files = out.toString('utf8').split('\0').filter(Boolean);
  } catch {
    return true; // not a git repo or git missing: nothing to lint
  }
  if (files.length === 0) return true;
  try {
    execFileSync('python3', ['-m', 'py_compile', ...files], {
      cwd: repoDir, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}
