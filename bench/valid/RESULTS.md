# Validation results — 2026-09-16, model `opencode/muse-spark-1.3-contributor-free`

12 tasks × 4 arms = 48 trials. 1 task void (v-merge: rate-limit zero-token across all arms, no measurement). n=11 valid.
Raw: `bench/valid/out/` (gitignored). Shared manifest, `tok_unit: pi-totalTokens` on all trials.

| arm | pass | tokens | × stock |
|---|---|---|---|
| stock | 0/11 | 230,811 | 1.00 |
| beam-only | 0/11 | 226,956 | 0.98 |
| frozen-only | 0/11 | 259,685 | 1.12 |
| beam+frozen | 11/11 | 415,399 | 1.80 |

Per-task beam+frozen ratios: 0.97–2.02× (early-stop: 1–2 branches typical, P2 never needed).
Every task went ✗/✗/✗/✓. Dev-green/frozen-fail observed repeatedly in beam-only (wrong fix, confident stop).

Reading: combination effect, not compute (beam-only ≈ stock tokens, still 0). Budget holds: 1.80× aggregate, worst task 2.02×.
Limit: n=11 synthetic, single model. 200-instance SWE-bench run is the real test.
