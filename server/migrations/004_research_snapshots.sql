CREATE TABLE research_snapshots (
  through_year integer PRIMARY KEY,
  summary jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
