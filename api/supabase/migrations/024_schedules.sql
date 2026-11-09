-- 024: daily scheduled runs. One row = "run this symbol every day at `time`
-- in `timezone`" (IANA name; `time` is the user's wall clock, so DST shifts
-- don't move the run off 21:00 local).

CREATE TABLE IF NOT EXISTS schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  share_name text NOT NULL,
  source text NOT NULL,
  agent_id text,
  model text,
  system_prompt text,
  skill_ids text[],
  max_steps int,
  max_tokens int,
  time text NOT NULL,
  timezone text NOT NULL,
  last_fired_date date,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS schedules_user_idx ON schedules (user_id);
