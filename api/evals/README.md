# Evals (Phase 0)

Baseline regression harness for analysis pipeline quality. **Offline and
deterministic — no network, no LLM calls** (the rubric suite injects a stub
judge).

## Run

```bash
cd api
npx tsx evals/run.ts            # run + compare against BASELINE.json
npx tsx evals/run.ts --update   # re-bless the baseline after an intended change
```

Exit code 1 on drift; prints a per-suite PASS/DRIFT summary plus the full
result JSON.

## Suites

| Suite | Exercises | Plan § |
|---|---|---|
| `predicates` | JSON-Logic predicate evaluation, custom ops (`min_last`, `count_gt`, …), null → INSUFFICIENT propagation | §6.3 |
| `evidence` | Evidence card assembly: fact ordering (F/E/C), token budget under the 2500 hard cap, deterministic hash | §6.4 |
| `chunks` | Token-bounded chunking with overlap, sentence-boundary cuts, `docHash` idempotency | §6.4 |
| `scoring` | Honest aggregation (unknown ≠ 0), pillar combination with a real 0, checklist verdict credits | §5.3 |
| `rubric` | Full v2 rubric scoring (predicates + stub-judged criteria) → per-parameter scoreChecklist | §6.7 |

## When to re-bless

Any **intended** change to a deterministic surface (spread decay, checklist
credits, evidence ordering, feature derivation) shifts results. Re-run with
`--update`, review the diff in `BASELINE.json`, and note the reason in
`BASELINE.md`'s history table. Unexplained drift = regression: fix the code,
don't bless it.
