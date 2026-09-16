import { execFileSync } from 'node:child_process';
import { lintRepo } from './lint.ts';
import type { FrozenTest } from './freeze.ts';
import { verifyIntact } from './freeze.ts';

export interface Verdict { frozen_pass: boolean; suite_pass_rate: number; lint: boolean; notes: string }

export interface PytestSummary { passed: number; failed: number; skipped: number; errors: number }

/** Robust pytest short-summary parser.
 *
 *  Rate definition: passed / (passed + failed + errors). Skipped tests are
 *  excluded from the denominator (they neither pass nor fail). Errors count
 *  as failures. No countable outcome (collection error, zero tests,
 *  unparseable output) yields rate 0.
 *
 *  Handles: `20 passed`, `1 failed, 20 passed`, `20 passed, 1 failed`,
 *  `1 failed, 19 passed, 2 skipped`, `20 passed, 1 skipped`, `1 error`. */
export function parsePytestSummary(out: string): { summary: PytestSummary; rate: number } {
  const summary: PytestSummary = { passed: 0, failed: 0, skipped: 0, errors: 0 };
  const add = (text: string): boolean => {
    let found = false;
    for (const m of text.matchAll(/(\d+)\s+(passed|failed|skipped|error|errors)\b/g)) {
      found = true;
      const n = Number(m[1]);
      if (m[2] === 'passed') summary.passed += n;
      else if (m[2] === 'failed') summary.failed += n;
      else if (m[2] === 'skipped') summary.skipped += n;
      else summary.errors += n;
    }
    return found;
  };
  // Authoritative: the last `=== ... ===` result line (e.g.
  // `=== 1 failed, 20 passed in 3.2s ===`). Fall back to whole-output scan
  // when pytest never printed one (collection error, crash).
  const resultLines = out.match(/^=+.*(passed|failed|error).*?=+\s*$/mg) ?? [];
  if (resultLines.length === 0 || !add(resultLines[resultLines.length - 1])) add(out);
  const denom = summary.passed + summary.failed + summary.errors;
  return { summary, rate: denom > 0 ? summary.passed / denom : 0 };
}
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
  const { rate } = parsePytestSummary(suite.out);
  const lint = lintRepo(repoDir);
  return { frozen_pass, suite_pass_rate: rate, lint, notes: suite.out.slice(-500) };
}
