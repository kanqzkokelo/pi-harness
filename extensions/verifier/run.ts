import { execFileSync } from 'node:child_process';
import type { FrozenTest } from './freeze.ts';
import { verifyIntact } from './freeze.ts';

export interface Verdict { frozen_pass: boolean; suite_pass_rate: number; lint: boolean; notes: string }
const run = (cmd: string, args: string[], cwd: string, timeout = 120000): { ok: boolean; out: string } => {
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: out.slice(-4000) };
  } catch (e: any) {
    return { ok: false, out: String(e?.stdout ?? e?.message ?? e).slice(-4000) };
  }
};

/** VERIFIER = deterministic execution only. Never generates tests. */
export function verify(repoDir: string, frozen: FrozenTest[], suiteCmd = 'pytest -q -x --tb=short'): Verdict {
  for (const t of frozen) if (!verifyIntact(t)) return { frozen_pass: false, suite_pass_rate: 0, lint: false, notes: `tainted:${t.path}` };
  let frozen_pass = true;
  for (const t of frozen) {
    const r = run('python3', ['-m', 'pytest', t.path, '-q', '--tb=short'], repoDir);
    if (!r.ok) { frozen_pass = false; break; }
  }
  const [s, ...sArgs] = suiteCmd.split(' ');
  const suite = run(s, sArgs, repoDir);
  const m = suite.out.match(/(\d+)\s+passed.*?(\d+)\s+failed|(\d+)\s+failed.*?(\d+)\s+passed|(\d+)\s+passed/);
  let rate = suite.ok ? 1 : 0;
  if (m) {
    const nums = m.slice(1).filter(Boolean).map(Number);
    const total = nums.reduce((a, b) => a + b, 0);
    const passed = suite.out.includes('passed') ? nums[0] : 0;
    if (total > 0) rate = passed / total;
  }
  const lint = run('python3', ['-m', 'py_compile', '.'], repoDir).ok;
  return { frozen_pass, suite_pass_rate: rate, lint, notes: suite.out.slice(-500) };
}
