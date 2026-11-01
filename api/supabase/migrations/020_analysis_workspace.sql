-- 020: in-memory research workspace snapshot.
-- The FS-workspace canvas pipeline archives tool payloads + distilled notes
-- into a per-run memfs volume; at run end the compacted snapshot (notes,
-- stubs, control files, composed sections — raw payloads excluded, the trace
-- already persists them) lands here. GET /analysis/:id selects "*", so the
-- snapshot flows to the UI with no handler change.

alter table public.analysis_runs
  add column if not exists workspace jsonb;
