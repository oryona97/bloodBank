ALTER TABLE users DROP CONSTRAINT users_role_check;
-- Legacy workers must be assigned a specific operational role by an administrator.
ALTER TABLE users ADD COLUMN active boolean NOT NULL DEFAULT true;
UPDATE users SET active = false WHERE role = 'WORKER';
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','OPERATOR','LAB','DISPENSER','RESEARCHER','WORKER'));
