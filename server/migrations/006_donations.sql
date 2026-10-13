CREATE TABLE donors (
  donor_id uuid PRIMARY KEY,
  demo_identifier text UNIQUE NOT NULL CHECK (demo_identifier ~ '^[0-9]{9}$'),
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE donations (
  donation_id uuid PRIMARY KEY,
  donor_id uuid NOT NULL REFERENCES donors,
  donation_date date NOT NULL,
  collected_at timestamptz,
  initial_type text NOT NULL CHECK (initial_type IN ('A+','O+','B+','AB+','A-','O-','B-','AB-')),
  verified_type text,
  lab_status text NOT NULL DEFAULT 'QUARANTINED' CHECK (lab_status IN ('QUARANTINED','RELEASED','REJECTED')),
  required_panel_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO donors(donor_id, demo_identifier, full_name)
SELECT gen_random_uuid(), donor_id, max(donor_full_name) FROM blood_units GROUP BY donor_id;
INSERT INTO donations(donation_id, donor_id, donation_date, initial_type,created_at)
SELECT b.unit_id, d.donor_id, b.donation_date, b.blood_type,b.created_at FROM blood_units b JOIN donors d ON d.demo_identifier=b.donor_id;
