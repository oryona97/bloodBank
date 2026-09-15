# Blood Bank

BECS student assignment for donation intake, routine blood dispensing, and emergency O-negative dispensing.

## Status

Planning stage. Application code has not been implemented yet.

See [PLAN.md](PLAN.md) for requirements, allocation rules, architecture, database design, and implementation milestones.

## Planned stack

- React, TypeScript, and Vite frontend
- Node.js, TypeScript, and Express backend
- PostgreSQL with node-postgres (`pg`) and SQL migrations
- Vitest and PostgreSQL integration tests

The client and server will live together in this repository under `client/` and `server/`, with shared API types under `shared/`.

## Assignment scope

This project follows the simplified compatibility and storage assumptions supplied in the assignment. It is an educational simulation, not a clinical transfusion system.
