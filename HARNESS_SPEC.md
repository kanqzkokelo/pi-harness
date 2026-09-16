# HARNESS_SPEC — Controlled-Branch State-Graph Harness (Pi/OpenCode Fork)

Locked decisions Q1-Q13. Budget: ≤3 branches, ≤2x tokens vs linear. Target: 27B+7-14B primary, frontier no-regress, 4B exploratory.

## 1. Verdict: architecture E + C, not A/B/D

* E (persistent state graph + search) + C (planner/executor/verifier) hybrid.
* Why not A linear: linear cannot recover. Evidence: SWE-Replay branching +3.8% resolve, -17.4% cost vs 10x from-scratch (measured, Devstral-Small, Verified).
* Why not full D MCTS: SWE-Search +23% relative over Moatless (measured, Lite) but ~100 iters/instance. Breaks 2x budget. Same for EvoScale Best@50, DeepSWE Pass@16 (71% vs 42% Pass@1, measured). Gain real, cost disqualifies for MVP.
* Why not B multi-agent collaboration: BOAD auto-hierarchy Seed-OSS-36B 12.3%->20.0% SWE-Live (+63% rel, measured), but needs bandit discovery + LLM-judge. Manual hierarchies often worse than monolith. Defer to v2.
* Why not pure C without graph: CodeMonkeys 57.4% Verified (measured), selection <10% cost, but needs 10x test+edit machines (~$4.6/prob). Too spendy. Shrink to 3-way controlled beam.
* Conclusion: controlled beam from same parent + deterministic verifier = cheapest validated search.

## 2. Highest-leverage ideas (evidence-backed)

1. **Controlled replay branching (SWE-Replay pattern).** Branch 50% from-scratch equivalent from same parent, no LLM-judge for branch-point choice. Measured: 60.0% vs 52% @ $1.52 vs $1.73 (50-mini ablation). LLM-judge variant worse (54% @ $3.31). Lesson: fixed points + heuristic > model-picked points.
2. **Frozen decoupled tests + execution-first selection (CodeMonkeys-lite + SWT-Bench + T1).** Naive self-test hurts 61.2%->57.3% (measured). Decoupled tester fixes. CodeMonkeys random-select 45.8% vs test-selected 57.4% (measured). T1 lesson: tools filter first, sLM last. MVP: no LLM judge for winner, only frozen pytest + existing suite + lint/typecheck.
3. **RepoGraph-lite + goal-conditioned prune (RepoGraph + SWE-Pruner + SeeRepo).** RepoGraph +32.8% rel avg across 4 frameworks (measured). SWE-Pruner 23-54% token cut, success up, rounds -26% (measured, incl. Sonnet 4.5 -39%). SeeRepo -25% tokens -26% cost, +0.4pp on GPT-5-mini (measured). All local, cheap. No LSP in MVP.
4. **Summary-tournament selection, not full-trace vote (RTV).** Claude-4.5-Opus mini-SWE 70.9->77.6% Verified; Terminus-1 46.9->59.1% Terminal-Bench v2 (measured). Cost = summaries only. MVP uses deterministic tests for winner, RTV summaries for logging/compression only — preserves path to v2 without paying judge noise now.
5. **Runtime supervisor filters, not post-hoc retry (SupervisorAgent + Failure-as-Process).** SupervisorAgent -29.7% tokens same success, hard L2 -32% (measured, GAIA). Failure study: decisive error median step 7/27, epistemic 57.9%, unverified assumption 30.7% (measured, 1794 Terminal-Bench trajs). MVP: LLM-free loop/premature/regression detectors. No learned supervisor yet.

## 3. Novel vs absorbed

* Already in Codex/Claude/Pi: linear tool loop, pytest execution, grep/rg context, fixed-threshold compact (Codex new_context, Claude compact.ts, Pi context-fold), manual subagents, parallel tool calls.
* NOT in them: persistent state graph with git-node rollback, controlled same-parent branching, frozen-test hash lock, Tree-sitter/import graph as first-class context, LLM-free failure detectors as gates.
* Genuinely novel combination (checked vs repos above): same-parent controlled beam (Q8 rule) + frozen-test winner + git-node/Docker-branch isolation within 2x budget. No framework ships this exact triple. Individual pieces exist (SWE-Replay, CodeMonkeys selection, RepoGraph), synthesis + budget constraint = new.
* Do NOT claim novelty for: MCTS, ORM/PRM verifiers, evolving skills, speculative execution, learned compact. All published, none in MVP.

## 4. Core state model

```ts
type StateNode = {
  id: string;             // git commit sha
  parent_id: string | null;
  branch_id: 'A'|'B'|'C';
  snapshot_ref: string;   // git sha + docker branch tag
  subtasks: {id:string; title:string; status:'todo'|'doing'|'done'|'blocked'}[];
  facts: string[];        // established, tool-grounded only
  actions: {tool:string; args:string; result_hash:string; ts:number}[];
  test_results: {frozen_pass:boolean; suite_pass_rate:number; lint:boolean};
  cost: {tokens:number; tool_calls:number; ms:number};
};
type Edge = {from:string; to:string; reason:string};
```

* Facts append-only, never edit. Hypotheses excluded in MVP (log only).
* Every node = git commit. Branch = Docker container + git worktree.
* Q8 rule: B/C fork from same parent_id as A at each fixed point. No chaining advantage.

## 5. Search algorithm: controlled beam, 2 fixed points

Acceptance threshold (all must hold): `frozen_pass=true AND suite_pass_rate >= parent_rate AND lint=true`.

```
P0: understand + localize (repo-graph top-k) -> parent S0
T0 TEST CONSTRUCTION (not verifier): generate repro tests pre-fix, sha256 lock.
P1 FIXED BRANCH: from S0, spawn A/B/C with diverse prompts:
  A: minimal patch, B: alternate localization, C: repro-driven
  run -> frozen tests (generated pre-fix, hash-locked) + suite subset + lint
  keep winner by: frozen_pass desc, suite_pass_rate desc, diff_size asc
  kill losers (keep logs+summaries). Cost cap: kill on >2x linear tokens.
P2 FIXED BRANCH: trigger when NO branch meets acceptance threshold (not only total fail).
  Covers: all fail OR frozen pass but suite/regression inferior.
  From P1 winner (call S1), spawn A2/B2/C2 same-parent retries
  with distinct strategies (edge-case, refactor, revert+minimal)
  same verifier. Pick winner or abort.
```

* No dynamic branching, no MCTS, no LLM judge in selection path.
* Beam width 3, depth 2. Matches budget.
* Comparison controlled: same parent, same frozen tests, same suite seed.

## 6. Verifier = deterministic execution stack only

Test construction (T0) is NOT verifier. T0 builds spec. Verifier executes + ranks.
Wrong-test guard: frozen never sole signal; suite subset + lint + diff-size required; audit 20 cases.

1. Frozen repro tests: generated before any fix, `sha256` locked. Taint = auto-fail branch.
2. Existing suite subset (related files via repo-graph) + lint/typecheck.
3. Winner rule above. No model confidence used.
4. Log-only model judge for v2 training data, never decides.

## 7. Repo intelligence (MVP)

* Build once: Tree-sitter symbols (def/class/func) + imports + file map -> `sqlite` index.
* Query per subtask: ego-graph around issue keywords + test files, top-k (k=8 files, 60k tokens cap).
* No LSP, no dataflow. v2 adds LSP refs + SWE-Pruner 0.6B skimmer.

## 8. Failure recovery (LLM-free gates)

* Loop: same tool+args hash 3x -> force next branch, prune action.
* Premature-stop: claims done + frozen_fail -> reject, rollback to parent.
* Regression: suite_pass_rate drops >5pp vs parent -> auto-rollback, mark branch dead.
* Tool misuse: failed command 2x -> inject `man`/schema hint once, then branch.

## 9. Context management

* Per-branch rolling window. On cap: structured prune — keep StateNode + facts + test_results, compress actions[] to 1-line summaries (RTV-style), drop raw tool stdout (keep hash + path).
* No full-trace voting. Summaries only.
* v2: Paritok-4B gateway (86.5% solve retained, CR 25% measured) + AutoCompact learned trigger (+10.6% measured).

## 10. Memory / router / self-improve (v2, NOT MVP)

* Memory: sqlite facts + summaries per repo. No vector KG in MVP (Mem0/Graphiti heavy). v2 adds Mem0-style narrow memory.
* Router: v2 cascade — 7-14B for localize/summarize, 27B for patch, frontier for judge/discovery only. MVP single-model per run for clean comparison.
* Self-improve: collect winner/loser pairs + frozen outcomes -> SFT/PRM data (SWE-Gym pattern, +14% abs measured for 32B). No training in MVP.

## 11. AGI-layer evaluation (skeptical)

* Include: goal persistence (subtasks[] + verifier gates), hierarchical plan (2-level only, planner->executor, BOAD-lite manual), experiment loop (generate-verify-revise, ReVeal +4pp measured), metacog via deterministic detectors (not self-report).
* Exclude from MVP: self-modeling, world models, autonomous decomposition, skill acquisition (SICA 17%->53% on small subset, overfit risk, needs harness-edit sandbox), speculation/rollback beyond git+Docker (55% hit-rate claim, prototype only), LLM self-critique as verifier (miscalibrated on small models per T1).
* Rule: no mechanism without benchmark lift per token. Reflection without execution = excluded.

## 12. MVP build (Pi fork, executable)

```
pi-harness/
  extensions/state-graph/ {store.ts, nodes.ts, gitops.ts}
  extensions/branch/ {beam.ts, promptsABC.ts}
  extensions/verifier/ {freeze.ts, run.ts, select.ts}
  extensions/repograph/ {index.ts, query.ts}  # tree-sitter + sqlite
  extensions/detectors/ {loop.ts, premature.ts, regression.ts}
  docker/branch.Dockerfile
```

Steps:
1. Fork pi, add `StateNode` sqlite + git commit per node (`gitops.ts`: commit, checkout, worktree).
2. `repograph/index.ts`: tree-sitter parse, imports, write sqlite. `query.ts`: top-k.
3. `verifier/freeze.ts`: generate repro test pre-fix, sha256 lock. `run.ts`: pytest subset + lint. `select.ts`: deterministic rank.
4. `branch/beam.ts`: implement P1/P2 same-parent spawn, Docker per branch (3 containers max), kill losers.
5. `detectors/*`: 3 gates wired into loop.
6. Logging: every node {id,parent,branch,tests,cost}, every branch comparison, token/tool counts.

## 13. Roadmap

* MVP (2-3 wks): above. Goal: win within 2x on 27B/14B.
* v2: router cascade + SWE-Pruner + Paritok + RTV vote + Mem0-narrow + BOAD-style 2-subagent cap.
* Research-grade: PRM/ORM at 3 chokepoints (SWE-Reasoner 46% 32B measured), EvoScale mutation, speculative actions, AutoCompact RL.

## 14. Benchmark protocol

* Arms (same model, repo, prompt, tools, tasks): (1) vanilla tool loop, (2) stock Pi/OpenCode, (3) proposed.
* Primary: SWE-bench Verified random 200 (cost-capped). Secondary: 10-20 long-horizon/debug/perf tasks (incl. incomplete tests + repo-wide).
* Metrics: pass@1, pass@3 (branch budget), tokens, wall-clock, tool calls, branches explored, recovery rate, verifier catches, context usage, $.
* Controls: same frozen tests per instance across arms, same Docker image, same suite seed. Report per-model-tier separately.

## 15. Expected lift (labelled)

* Measured (literature, not promise): replay-branch +3.8pp resolve -17% cost; test-selection 45.8%->57.4%; RepoGraph +32.8% rel; Pruner -39% tokens success up; RTV +6.7pp (70.9->77.6); Supervisor -30% tokens same success; 32B+TTC beats 405B-671B (SWE-Reasoner 46% vs R1/o1).
* Extrapolation (MVP, 27B/14B, ≤3 branches, 2x cap): +5 to +12pp pass@1 vs stock Pi on Verified; -20 to -35% tokens vs naive 3x ensemble due to same-parent prune + early kill. Hypothesis, must measure.
* Frontier: +2 to +5pp (ceiling high, harness adds less). 4B: high variance, exploratory — T1 pattern says execution-first helps, but 4B breaks on reflection; expect -10% to +8pp. Hypothesis.
* Cost: ~1.6-2.0x tokens vs linear (by design). Wall-clock ~1.2-1.5x with parallel branches.

## 16. Biggest risks

1. Frozen-test quality: bad repro locks in wrong target. Mitigate: decoupled tester prompt + suite subset + human audit 20 cases.
2. Same-parent diversity collapse: 3 branches produce same patch. Mitigate: distinct strategy prompts + temperature + alternate localization enforced via repograph.
3. Small-model tool misuse floods budget. Mitigate: detectors + schema hint + kill fast.
4. Docker/git overhead breaks local-first. Mitigate: git worktree default, Docker opt-out flag.
5. Overfitting to Verified. Mitigate: secondary long-horizon set with incomplete tests.

## 17. Reuse list (inspect first)

* `github.com/aorwall/moatless-tree-search` / 2410.20285 (MCTS baseline, skip for MVP but read value-agent)
* `scalingintelligence.stanford.edu/pubs/codemonkeys` / 2501.14723 (selection state-machine)
* `github.com/yingweima2022/SWE-Reasoner` / 2503.23803 (PRM chokepoints for v2)
* 2601.22129 SWE-Replay (MVP branching pattern — closest)
* `github.com/SWE-Gym/SWE-Gym` / 2412.21139 (verifier training data for v2)
* 2604.16529 RTV (summary tournament)
* `github.com/ozyyshr/RepoGraph` / 2410.14684 + `github.com/cslsolow/SeeRepo` (MVP graph)
* 2601.16746 SWE-Pruner, `huggingface.co/paritok/paritok-4b-v1`, autocompact.github.io (v2 compression)
* `github.com/LINs-lab/SupervisorAgent` / 2510.26585, `github.com/ulab-uiuc/AgentDebug` / 2509.25370, 2607.09510 (detectors)
* `github.com/iamxjy/BOAD-SWE-Agent` / 2512.23631, `github.com/agentica-project/rllm`, `All-Hands-AI/OpenHands#9738` (v2 hierarchy/router)
* SWT-Bench 2406.12952, `Shimly-2/ReVeal`, 2504.15228 SICA (test + revise loop refs)

## 18. Most important experiment

4-arm ablation (same model, same T0 tests, same image/seed):
(1) stock Pi, (2) beam only, (3) frozen-test selection only, (4) beam + frozen.
H0: (4) ≤2x tokens does NOT beat (1) pass@1.
Kill: <+4pp lift or >2x cost. Pass only if recovery + verifier catches explain lift.
Isolates whether architecture creates capability or merely spends compute.
Single-model order: 27B first, then 14B. 200 Verified instances.
