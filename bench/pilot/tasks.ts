import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { freezeTest } from '../../extensions/verifier/freeze.ts';
import type { TaskDef } from '../ablation.ts';

export const MODEL = 'opencode/muse-spark-1.3-contributor-free';
export const TOKEN_BUDGET = 60000;

export interface TaskSeed { id: string; file: string; buggy: string; frozenName: string; frozenSrc: string; devName: string; devSrc: string; brief: string; extraFiles?: Record<string, string> }

export const PILOT_SEEDS: TaskSeed[] = [
  {
    id: 'pilot-range-sum', file: 'rsum.py',
    buggy: 'def rsum(n):\n    return sum(range(n))\n',
    frozenName: 'test_t0.py',
    frozenSrc: 'from rsum import rsum\ndef test_basic(): assert rsum(5) == 15\ndef test_one(): assert rsum(1) == 1\ndef test_zero(): assert rsum(0) == 0\n',
    devName: 'test_dev.py',
    devSrc: 'from rsum import rsum\ndef test_smoke(): assert rsum(3) == 6\n',
    brief: 'rsum(n) should return sum of 1..n inclusive, currently off by one.',
  },
  {
    id: 'pilot-reverse', file: 'rev.py',
    buggy: 'def rev(s):\n    return s\n',
    frozenName: 'test_t0.py',
    frozenSrc: 'from rev import rev\ndef test_basic(): assert rev("abc") == "cba"\ndef test_empty(): assert rev("") == ""\ndef test_single(): assert rev("x") == "x"\n',
    devName: 'test_dev.py',
    devSrc: 'from rev import rev\ndef test_smoke(): assert rev("ab") == "ba"\n',
    brief: 'rev(s) should return the reversed string, currently returns input unchanged.',
  },
  {
    id: 'pilot-clamp', file: 'clamp.py',
    buggy: 'def clamp(v, lo, hi):\n    return v\n',
    frozenName: 'test_t0.py',
    frozenSrc: 'from clamp import clamp\ndef test_lo(): assert clamp(-5, 0, 10) == 0\ndef test_hi(): assert clamp(99, 0, 10) == 10\ndef test_mid(): assert clamp(4, 0, 10) == 4\n',
    devName: 'test_dev.py',
    devSrc: 'from clamp import clamp\ndef test_smoke(): assert clamp(4, 0, 10) == 4\n',
    brief: 'clamp(v,lo,hi) should bound v into [lo,hi], currently returns v unchanged.',
  },
];

/** Scaffold task repos, commit base+T0, return manifest (model pinned). */
export function buildTasks(root: string, seeds: TaskSeed[]): { manifestTasks: TaskDef[]; briefs: Record<string, string> } {
  const manifestTasks: TaskDef[] = [];
  const briefs: Record<string, string> = {};
  for (const t of seeds) {
    const dir = join(root, t.id);
    mkdirSync(dir, { recursive: true });
    const g = (a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
    if (!existsSync(join(dir, '.git'))) { g(['init', '-q']); g(['config', 'user.email', 'p@p']); g(['config', 'user.name', 'p']); }
    writeFileSync(join(dir, t.file), t.buggy);
    for (const [name, src] of Object.entries(t.extraFiles ?? {})) writeFileSync(join(dir, name), src);
    writeFileSync(join(dir, t.devName), t.devSrc);
    g(['add', '-A']); g(['commit', '-qm', 'base', '--allow-empty']);
    const frozen = freezeTest(dir, t.frozenName, t.frozenSrc);
    g(['add', '-A']); g(['commit', '-qm', 't0']);
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    manifestTasks.push({
      id: t.id, repoDir: dir, base_commit: sha, brief: t.brief,
      frozen: { path: frozen.path, sha: frozen.sha },
      model: MODEL, suiteCmd: 'python3 -m pytest test_dev.py -q --tb=line',
      token_budget: TOKEN_BUDGET, env: { image: 'local', seed: 7 },
    });
    briefs[t.id] = t.brief;
  }
  return { manifestTasks, briefs };
}

export const buildPilot = (root: string) => buildTasks(root, PILOT_SEEDS);
