ALTER TABLE dispense_events ADD COLUMN product_type text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE dispense_events ADD COLUMN recipient_reference text;
ALTER TABLE dispense_events ADD COLUMN issued_by uuid REFERENCES users(id);
ALTER TABLE dispense_events DROP CONSTRAINT dispense_events_check;
ALTER TABLE dispense_events ADD CONSTRAINT dispense_mode_valid CHECK (
  (mode='ROUTINE' AND recipient_blood_type IS NOT NULL AND requested_quantity > 0) OR
  (mode='EMERGENCY' AND recipient_blood_type IS NULL AND ((product_type='LEGACY' AND requested_quantity IS NULL) OR (product_type='PRBC' AND requested_quantity > 0)))
);
CREATE TABLE dispense_event_components (
  event_id uuid NOT NULL REFERENCES dispense_events,
  component_id uuid PRIMARY KEY REFERENCES blood_components
);
INSERT INTO dispense_event_components SELECT event_id,unit_id FROM dispense_event_units;
