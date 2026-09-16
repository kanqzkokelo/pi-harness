# Pilot results — 2026-09-16, model `opencode/muse-spark-1.3-contributor-free`

3 toy tasks × 4 arms = 12 trials. Shared manifest (base commit, frozen sha, model, seed).
Raw: `bench/pilot/out/` (gitignored: trials.jsonl, deltas.json, summary.txt, pilot.log).

| arm | pass | tokens |
|---|---|---|
| stock | 0/3 | 62,051 |
| beam-only | 0/3 | 185,392 |
| frozen-only | 0/3 | 70,669 |
| beam+frozen | 3/3 | 183,965 |

Per-task: every task went ✗/✗/✗/✓. Beam-only spent ~3× tokens, still 0 — combination effect, not compute effect.

Caveats: n=3 toy bugs, single model, pilot prompts differ slightly by arm by design.
Cost note: ~3× stock tokens here, above 2× MVP budget — needs pruning (early-kill, P2 skip on accept) before scale-up.
Next: 10–20 real repo tasks, then 200-instance Verified sample.
