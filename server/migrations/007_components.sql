CREATE TABLE component_types (
  type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code IN ('PRBC','FFP','Platelets','Cryoprecipitate','LEGACY')),
  policy_version integer NOT NULL,
  expiry_days integer NOT NULL CHECK (expiry_days >= 0),
  storage_class text NOT NULL,
  min_c numeric,
  max_c numeric,
  agitation boolean NOT NULL DEFAULT false,
  UNIQUE(code,policy_version)
);
INSERT INTO component_types(code,policy_version,expiry_days,storage_class,min_c,max_c,agitation) VALUES
('PRBC',1,42,'REFRIGERATED',1,6,false),('FFP',1,365,'FROZEN',NULL,-18,false),
('Platelets',1,5,'AGITATED',20,24,true),('Cryoprecipitate',1,365,'FROZEN',NULL,-18,false),
('LEGACY',0,0,'UNKNOWN',NULL,NULL,false);
CREATE TABLE storage_locations (
  location_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text UNIQUE NOT NULL,
  storage_class text NOT NULL
);
INSERT INTO storage_locations(label,storage_class) VALUES ('Demo refrigerator','REFRIGERATED'),('Demo freezer','FROZEN'),('Demo platelet agitator','AGITATED');
ALTER TABLE donations ADD COLUMN processed_at timestamptz;
CREATE TABLE blood_components (
  component_id uuid PRIMARY KEY,
  donation_id uuid NOT NULL REFERENCES donations,
  type_id uuid NOT NULL REFERENCES component_types,
  source_component_id uuid REFERENCES blood_components,
  location_id uuid REFERENCES storage_locations,
  produced_at timestamptz,
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'QUARANTINED' CHECK (status IN ('QUARANTINED','AVAILABLE','DISPENSED','PROCESSED','DISCARDED')),
  discard_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX component_stock ON blood_components(type_id,expires_at,donation_id) WHERE status='AVAILABLE';
INSERT INTO blood_components(component_id,donation_id,type_id,status,created_at)
SELECT b.unit_id,b.unit_id,t.type_id,CASE WHEN b.status='DISPENSED' THEN 'DISPENSED' ELSE 'QUARANTINED' END,b.created_at
FROM blood_units b CROSS JOIN component_types t WHERE t.code='LEGACY';
