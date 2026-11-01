# Evals

## FS-vs-loop eval

Compares filesystem-workspace mode against the tool-loop harness on real
symbols. Manual, network-dependent, no baseline file.

```bash
cd api
npx tsx evals/fs-vs-loop.ts
```

The old offline baseline harness (`evals/run.ts`, BASELINE.json) targeted the
deleted scoring/predicates generation and was removed with it.
