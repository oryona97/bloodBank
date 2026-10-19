-- Existing profile versions acquire an explicit basis without changing expiry values.
-- Bases remain fixed to the approved simulation products.
ALTER TABLE component_types ADD COLUMN expiry_basis text GENERATED ALWAYS AS (
  CASE WHEN code='Cryoprecipitate' THEN 'SOURCE_EXPIRY'
       WHEN code='LEGACY' THEN 'UNKNOWN' ELSE 'COLLECTION' END
) STORED;
