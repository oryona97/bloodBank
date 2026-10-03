CREATE TABLE users (
  id uuid PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ADMIN', 'WORKER', 'RESEARCHER')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE VIEW deidentified_blood_units AS
SELECT unit_id, blood_type, donation_date, status, created_at
FROM blood_units;
