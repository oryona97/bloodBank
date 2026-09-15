CREATE TABLE inventory_lock (id integer PRIMARY KEY CHECK (id = 1));
INSERT INTO inventory_lock VALUES (1);

CREATE TABLE blood_units (
  unit_id uuid PRIMARY KEY,
  blood_type text NOT NULL CHECK (blood_type IN ('A+', 'O+', 'B+', 'AB+', 'A-', 'O-', 'B-', 'AB-')),
  donation_date date NOT NULL,
  donor_id text NOT NULL CHECK (donor_id ~ '^[0-9]{9}$'),
  donor_full_name text NOT NULL CHECK (length(trim(donor_full_name)) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'DISPENSED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX available_units ON blood_units (blood_type, donation_date, unit_id) WHERE status = 'AVAILABLE';

CREATE TABLE dispense_events (
  event_id uuid PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('ROUTINE', 'EMERGENCY')),
  recipient_blood_type text CHECK (recipient_blood_type IN ('A+', 'O+', 'B+', 'AB+', 'A-', 'O-', 'B-', 'AB-')),
  requested_quantity integer,
  issued_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode = 'ROUTINE' AND recipient_blood_type IS NOT NULL AND requested_quantity IS NOT NULL AND requested_quantity > 0)
    OR (mode = 'EMERGENCY' AND recipient_blood_type IS NULL AND requested_quantity IS NULL))
);
CREATE TABLE dispense_event_units (
  event_id uuid NOT NULL REFERENCES dispense_events(event_id),
  unit_id uuid PRIMARY KEY REFERENCES blood_units(unit_id)
);
CREATE INDEX dispense_event_links ON dispense_event_units(event_id);

CREATE TABLE operation_requests (
  request_key uuid PRIMARY KEY,
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
