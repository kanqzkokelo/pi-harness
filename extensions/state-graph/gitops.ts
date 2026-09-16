import { execFileSync } from 'node:child_process';

/** git ops: sha per node, worktree per branch. Cwd = target repo. */
const g = (args: string[], cwd: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export const currentSha = (cwd: string): string => g(['rev-parse', 'HEAD'], cwd);
export const commitNode = (cwd: string, msg: string): string => {
  g(['add', '-A'], cwd);
  try { g(['commit', '-m', msg, '--allow-empty'], cwd); } catch { /* empty */ }
  return currentSha(cwd);
};
export const worktreeAdd = (cwd: string, path: string, branch: string, base = 'HEAD'): void => {
  g(['worktree', 'add', '--detach', path, base], cwd);
  void branch;
};
export const worktreeRemove = (cwd: string, path: string, force = true): void => {
  try { g(['worktree', 'remove', ...(force ? ['--force'] : []), path], cwd); } catch { /* gone */ }
};
export const checkoutSha = (cwd: string, sha: string): void => { g(['checkout', '--detach', sha], cwd); };
export const diffSize = (cwd: string, from: string, to: string): number => {
  try { return g(['diff', '--numstat', `${from}..${to}`], cwd).split('\n').filter(Boolean).length; }
  catch { return Number.MAX_SAFE_INTEGER; }
};
