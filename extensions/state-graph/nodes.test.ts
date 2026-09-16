import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCEPT, type StateNode, zeroCost } from './nodes.ts';

const mk = (frozen: boolean, rate: number, lint = true): StateNode => ({
  id: 'x', parent_id: 'p', branch_id: 'A', snapshot_ref: 'git:x',
  subtasks: [], facts: [], actions: [],
  test_results: { frozen_pass: frozen, suite_pass_rate: rate, lint },
  cost: zeroCost(),
});

test('parent 1.0, green candidate accepts', () => assert.equal(ACCEPT(mk(true, 1), 1), true));
test('parent 0.94, candidate 0.94 accepts (no regression)', () => assert.equal(ACCEPT(mk(true, 0.94), 0.94), true));
test('parent 0.94, candidate 0.95 accepts (improvement)', () => assert.equal(ACCEPT(mk(true, 0.95), 0.94), true));
test('parent 0.94, candidate 0.93 rejects (regression)', () => assert.equal(ACCEPT(mk(true, 0.93), 0.94), false));
test('frozen fail rejects even when suite green', () => assert.equal(ACCEPT(mk(false, 1), 1), false));
test('lint fail rejects', () => assert.equal(ACCEPT(mk(true, 1, false), 1), false));
