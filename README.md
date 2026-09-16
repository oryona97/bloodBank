# Blood Bank

BECS student assignment for donation intake, routine blood dispensing, and emergency O-negative dispensing.

## Status

The first application is implemented: donation intake, routine allocation and confirmation, emergency O-negative release, live inventory, and recent activity. PostgreSQL stores all units and dispensing records.

See [PLAN.md](PLAN.md) for the development checklist (`[x]` means completed), requirements, allocation rules, architecture, and verification results.

## Submission materials

The [Hebrew submission guide](docs/submission/guide.he.html) includes eight application screenshots, workflow explanations, allocation rules, and verification results. Download it and open it in a browser; all images are embedded for offline viewing.

See the [documentation package](docs/BECS-submission.zip), [editable explanations](docs/submission/explanations.he.md), and [remaining submission checklist](docs/submission/README.he.md). Review against the updated course slides remains pending until they are provided.

## Stack

- React, TypeScript, and Vite frontend
- Node.js, TypeScript, and Express backend
- PostgreSQL with node-postgres (`pg`) and SQL migrations
- Vitest and PostgreSQL integration tests

The frontend lives in `client/`, the backend and migrations in `server/`, and shared API types in `shared/`.

## Run locally

Prerequisites: Node.js 24 or newer, npm, and Docker with Compose. An existing PostgreSQL installation can be used instead by supplying its connection string.

Run these commands from the repository root:

```sh
npm ci
```

Copy `.env.example` to `.env`. In PowerShell:

```powershell
Copy-Item .env.example .env
```

On macOS or Linux, use `cp .env.example .env`. The example connection strings match the local Docker configuration. If you change the Docker password, set `POSTGRES_PASSWORD` in `.env` and update the connection strings to match before first creating the database volume.

```sh
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

If migration starts before PostgreSQL is ready, check `docker compose ps` and rerun the migration after the service becomes healthy.

Open [http://127.0.0.1:5188](http://127.0.0.1:5188). The API runs at port `3001`; Vite forwards `/api` requests to it. Keep the development API at the default port unless you also update the Vite proxy. Both bind to localhost.

The seed command creates 41 synthetic units on the first run. It is safe to repeat: it does not duplicate donations or refill units already dispensed. Demo donors have fabricated names and IDs.

To stop development servers, press Ctrl+C. Stop PostgreSQL with `docker compose stop db`; its named volume preserves inventory. Restart it with `docker compose up -d db`.

## Build and run the production bundle locally

```sh
npm run build
npm start
```

After stopping the development API, open [http://127.0.0.1:3001](http://127.0.0.1:3001). The Express process serves both the built frontend and API. Run from the repository root and keep the configured PostgreSQL service running. This is local execution, not a public deployment.

## Verify the project

Create the separate test database once:

```sh
docker compose exec -T db createdb -U bloodbank bloodbank_test
```

Set `TEST_DATABASE_URL` in `.env` (the example already matches this database), then run:

```sh
npm test
npm run test:integration
npm run build
npm run format:check
```

- 74 domain tests cover the complete compatibility matrix, allocation priorities, and invalid quantities.
- 16 integration tests run against real PostgreSQL and cover validation, shortages, oldest-first selection, transaction rollback, stale previews, concurrent dispensing, persistence, constraints, and retry handling.
- Integration tests clear only their configured test database's application tables. The runner requires a database name ending in `_test`, distinct from `DATABASE_URL`.
- The GitHub Actions workflow runs formatting, tests, and the build on pushes and pull requests.
- `npm run format` formats source and documentation.

## Demo walkthrough

1. **Donation intake:** Enter a type, valid date, synthetic full name, and 9-digit ID. Register the donation and check that the type's stock increases by one.
2. **Routine dispensing:** Request one A+ unit and preview the result. Cancel once to verify inventory stays unchanged. Preview again and confirm to issue it.
3. **Alternatives:** Request more A+ units than its exact stock, while staying within total compatible stock. The preview combines A+, O+, A-, and finally O- as necessary. Only compatible types are shown.
4. **Shortage:** Request 1,000 units from the demo inventory. The app reports the shortfall and offers no confirmation action.
5. **Emergency dispensing:** Review the O-negative quantity, choose release, and confirm. All current O- units are issued. The empty-stock message appears afterward and prevents another release.
6. Reload the page. Counts and recent activity should remain. New O- donations make emergency release available again.

All demo operations change the local database. Add synthetic donations through the intake screen to replenish stock for another walkthrough.

## Allocation and data decisions

- Exact type first; then compatible alternatives by descending assignment population share, with O- last among alternatives.
- Requests may combine several compatible types. Insufficient total stock causes no dispensing: fulfillment is all-or-nothing.
- Oldest donations are issued first within each type. No expiry is modeled.
- One donation submission creates one unit. Donor IDs are stored as text and validated as 9 digits; checksum validation is not part of this assignment implementation.
- The backend rechecks stock on confirmation. Transactions serialize inventory writes so routine and emergency requests cannot issue the same units.
- Donation and dispensing writes use UUID `Idempotency-Key` headers. Retrying the same action with the same key returns the original receipt instead of issuing again.

## API

| Method | Route                       | Purpose                                          |
| ------ | --------------------------- | ------------------------------------------------ |
| GET    | `/api/health`               | Check database/schema connectivity               |
| GET    | `/api/inventory`            | Available counts and the latest eight activities |
| POST   | `/api/donations`            | Register one unit                                |
| POST   | `/api/dispensing/preview`   | Preview an allocation without changing stock     |
| POST   | `/api/dispensing/confirm`   | Validate and issue the previewed allocation      |
| POST   | `/api/dispensing/emergency` | Issue all current O-negative stock               |

Runtime input validation is enforced on the API. Writes require an `Idempotency-Key` UUID. Invalid input returns HTTP 400; stale allocations and empty emergency stock return 409. Database unavailability returns 503.

## Assignment scope

This project follows the simplified compatibility and storage assumptions supplied in the assignment. It is an educational simulation, not a clinical transfusion system.
