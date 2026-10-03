import 'dotenv/config';
import { Pool } from 'pg';
export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString && !process.env.PGHOST)
    throw new Error(
      'Configure PostgreSQL with DATABASE_URL or PGHOST and the standard PG variables.',
    );
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
}
