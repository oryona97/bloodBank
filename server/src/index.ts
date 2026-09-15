import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';
import { createPool } from './storage/database.js';
const pool = createPool();
const app = createApp(pool);
const assets = resolve('dist/client');
if (existsSync(assets)) {
  app.use(express.static(assets));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve(assets, 'index.html')));
}
const server = app.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1', () =>
  console.log(
    `Blood Bank API listening on http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 3001}`,
  ),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () =>
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    }),
  );
