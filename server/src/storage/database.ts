import 'dotenv/config';
import { Pool } from 'pg';
export function createPool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString)
    throw new Error('DATABASE_URL is missing. Copy .env.example to .env and configure PostgreSQL.');
  return new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
}
