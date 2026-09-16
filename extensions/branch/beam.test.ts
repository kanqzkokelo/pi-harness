import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runBeam, type Strategy } from './beam.ts';
import { freezeTest } from '../verifier/freeze.ts';
import { verify } from '../verifier/run.ts';

const G = (d: string, a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });

/** Tmp repo: buggy a.py (v=0), frozen asserts v==1, dev suite asserts v>=0. */
function setup(): { dir: string; frozen: { path: string; sha: string } } {
  const d = mkdtempSync(join(tmpdir(), 'beam-t-'));
  G(d, ['init', '-q']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
  writeFileSync(join(d, 'a.py'), 'v = 0\n');
  writeFileSync(join(d, 'test_dev.py'), 'from a import v\ndef test_nonneg(): assert v >= 0\n');
  const frozen = freezeTest(d, 'test_t0.py', 'from a import v\ndef test_one(): assert v == 1\n');
  G(d, ['add', '-A']); G(d, ['commit', '-qm', 'base']);
  return { dir: d, frozen };
}

const writeA = (body: string, tokens = 100): Strategy => async (dir: string) => {
  writeFileSync(join(dir, 'a.py'), body);
  return { tokens, toolCalls: 1 };
};
const BROKEN = writeA('v = 0\n', 111);
const FIXED = writeA('v = 1\n', 222);

test('same-parent branching: all nodes share parent', async () => {
  const { dir, frozen } = setup();
  const parent = verify(dir, [frozen], 'true').suite_pass_rate;
  const r = await runBeam([frozen], {
    repoDir: dir, suiteCmd: 'true', parentSuitePassRate: parent, earlyStop: false,
    strategies: { A: BROKEN, B: BROKEN, C: BROKEN },
  });
  assert.equal(r.ranked.length, 3);
  assert.ok(r.ranked.every((n) => n.parent_id === r.parentSha));
  assert.equal(new Set(r.ranked.map((n) => n.id)).size, 3);
});

test('early-stop: accept on A halts phase', async () => {
  const { dir, frozen } = setup();
  const parent = verify(dir, [frozen], 'true').suite_pass_rate;
  const r = await runBeam([frozen], {
    repoDir: dir, suiteCmd: 'true', parentSuitePassRate: parent, earlyStop: true,
    strategies: { A: FIXED, B: BROKEN, C: BROKEN },
  });
  assert.equal(r.ranked.length, 1);
  assert.equal(r.best.test_results.frozen_pass, true);
});

test('P2 triggers on threshold miss, not only total fail', async () => {
  const { dir, frozen } = setup();
  const parent = verify(dir, [frozen], 'true').suite_pass_rate;
  const r = await runBeam([frozen], {
    repoDir: dir, suiteCmd: 'true', parentSuitePassRate: parent, earlyStop: false,
    strategies: { A: BROKEN, B: BROKEN, C: BROKEN },
    retryStrategies: { A: FIXED, B: BROKEN, C: BROKEN },
  });
  assert.equal(r.rounds, 2);
  assert.equal(r.best.test_results.frozen_pass, true);
});

test('P2 skipped when P1 accepts', async () => {
  const { dir, frozen } = setup();
  const parent = verify(dir, [frozen], 'true').suite_pass_rate;
  const r = await runBeam([frozen], {
    repoDir: dir, suiteCmd: 'true', parentSuitePassRate: parent, earlyStop: false,
    strategies: { A: FIXED, B: BROKEN, C: BROKEN },
    retryStrategies: { A: BROKEN, B: BROKEN, C: BROKEN },
  });
  assert.equal(r.rounds, 1);
});

test('state cost matches executor-reported cost', async () => {
  const { dir, frozen } = setup();
  const parent = verify(dir, [frozen], 'true').suite_pass_rate;
  const r = await runBeam([frozen], {
    repoDir: dir, suiteCmd: 'true', parentSuitePassRate: parent, earlyStop: true,
    strategies: { A: FIXED, B: BROKEN, C: BROKEN },
  });
  assert.equal(r.best.cost.tokens, 222);
  assert.equal(r.best.cost.tool_calls, 1);
  assert.ok(r.best.cost.ms >= 0);
  assert.deepEqual(r.best.actions, []);
});

test('snapshot_ref persistent, worktree metadata separate', async () => {
  const { dir, frozen } = setup();
  const parent = verify(dir, [frozen], 'true').suite_pass_rate;
  const r = await runBeam([frozen], {
    repoDir: dir, suiteCmd: 'true', parentSuitePassRate: parent, earlyStop: true,
    strategies: { A: FIXED, B: BROKEN, C: BROKEN },
  });
  assert.match(r.best.snapshot_ref, /^git:[0-9a-f]{40}$/);
  assert.ok(!r.best.snapshot_ref.includes('/tmp'));
  assert.ok(r.best.runtime?.worktree);
});

test('nested frozen paths staged distinctly', async () => {
  const d = mkdtempSync(join(tmpdir(), 'beam-n-'));
  G(d, ['init', '-q']); G(d, ['config', 'user.email', 't@t']); G(d, ['config', 'user.name', 't']);
  writeFileSync(join(d, 'a.py'), 'v = 0\n');
  mkdirSync(join(d, 'tests', 'u'), { recursive: true });
  mkdirSync(join(d, 'tests', 'i'), { recursive: true });
  const f1 = freezeTest(join(d, 'tests', 'u'), 'test_x.py', 'from a import v\ndef test_u(): assert v == 1\n');
  const f2 = freezeTest(join(d, 'tests', 'i'), 'test_x.py', 'from a import v\ndef test_i(): assert v == 1\n');
  G(d, ['add', '-A']); G(d, ['commit', '-qm', 'base']);
  const parent = verify(d, [f1, f2], 'true').suite_pass_rate;
  const r = await runBeam([f1, f2], {
    repoDir: d, suiteCmd: 'true', parentSuitePassRate: parent, earlyStop: true,
    strategies: { A: FIXED, B: BROKEN, C: BROKEN },
  });
  assert.equal(r.best.test_results.frozen_pass, true);
});

test('regression rejected: suite drop below parent fails accept', async () => {
  const { dir, frozen } = setup();
  const suite = 'python3 -m pytest test_dev.py -q --tb=line';
  const parent = verify(dir, [frozen], suite).suite_pass_rate;
  assert.equal(parent, 1);
  const regressive: Strategy = async (wd: string) => {
    writeFileSync(join(wd, 'a.py'), 'v = -5\n'); // frozen fails AND dev fails
    return { tokens: 50 };
  };
  const r = await runBeam([frozen], {
    repoDir: dir, suiteCmd: suite, parentSuitePassRate: parent, earlyStop: false,
    strategies: { A: regressive, B: regressive, C: regressive },
  });
  assert.ok(r.ranked.every((n) => n.test_results.suite_pass_rate < parent));
  assert.equal(r.best.test_results.frozen_pass, false);
});
