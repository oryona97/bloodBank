# Blood Bank

BECS student assignment for donation intake, routine blood dispensing, and emergency O-negative dispensing.

## Status

Donation intake, routine allocation and confirmation, emergency O-negative release, live inventory, and recent activity are implemented. PostgreSQL also stores an append-only audit trail, and **Export Records** downloads the complete application records and logs as JSON.

See [PLAN.md](PLAN.md) for the development checklist (`[x]` means completed), requirements, allocation rules, architecture, and verification results.

## Submission materials

The [Hebrew submission guide](docs/submission/guide.he.html) includes eight application screenshots, workflow explanations, allocation rules, and verification results. Download it and open it in a browser; all images are embedded for offline viewing.

The screenshots describe the original BECS workflows. The audit and export additions are documented below. Review against the updated course slides remains pending until they are provided.

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

For an existing installation, stop the API and run `npm run db:migrate` before restarting it. Migration `003_complete_audit.sql` preserves existing records and audit history while adding audit metadata and append-only protection. Historical entries keep their original details and receive `unknown`/`legacy` attribution; missing historical identities or unit links are not fabricated.

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
- 25 integration tests run against real PostgreSQL: the 16 original regression cases plus audit coverage, immutable history, rollback on audit failure, full exports, and an export with a concurrent donation.
- Integration tests create and remove a randomly named schema in the configured test database, leaving existing schemas untouched. The runner requires a database name ending in `_test`, distinct from `DATABASE_URL`, and a test role allowed to create schemas.
- The GitHub Actions workflow runs formatting, tests, and the build on pushes and pull requests.
- `npm run format` formats source and documentation.

## Demo walkthrough

1. **Donation intake:** Enter a type, valid date, synthetic full name, and 9-digit ID. Register the donation and check that the type's stock increases by one.
2. **Routine dispensing:** Request one A+ unit and preview the result. Cancel once to verify inventory stays unchanged. Preview again and confirm to issue it.
3. **Alternatives:** Request more A+ units than its exact stock, while staying within total compatible stock. The preview combines A+, O+, A-, and finally O- as necessary. Only compatible types are shown.
4. **Shortage:** Request 1,000 units from the demo inventory. The app reports the shortfall and offers no confirmation action.
5. **Emergency dispensing:** Review the O-negative quantity, choose release, and confirm. All current O- units are issued. The empty-stock message appears afterward and prevents another release.
6. Reload the page. Counts and recent activity should remain. New O- donations make emergency release available again.
7. Select **Export Records**. Open `bloodbank_export.json` in a text editor and inspect `auditLogs`, including previews, cancellations, failures, and the export event itself. Older entries remain available even though the dashboard shows only eight recent donations/dispensing events.

Reads and previews add audit entries without changing stock. Add synthetic donations through the intake screen to replenish stock for another walkthrough.

## Audit trail and copies of records

The audit trail records donation registration, routine and emergency dispensing, inventory reads, allocation previews (including shortages), explicit routine/emergency cancellations, health checks, exports, rejected requests, and request retries. Successful stock changes and their audit records commit together. A failure to store the success audit rolls back the stock change. Rejected API requests are recorded after rollback, with their error code and status; malformed payloads are not copied into the audit trail.

Each new entry includes a database timestamp, sequence number, action, outcome, source, actor, and details. API entries also have a server-generated request ID (returned in `X-Request-Id`), HTTP method/path, and the supplied idempotency key when present. Donation entries identify the created unit; dispensing entries identify the event and every issued unit. Retries create `REQUEST_REPLAYED` entries without repeating the stock change. The UI waits for cancellation to be recorded before dismissing its confirmation.

This application has no user login: API actors are honestly recorded as `anonymous`; seed and internal operations identify their system source. This does not establish the identity of a human operator. Browser-only interactions such as typing or changing tabs are not business records. Database triggers reject audit `UPDATE`, `DELETE`, and `TRUNCATE`; a database owner/administrator can still change the schema or disable triggers. If PostgreSQL is unavailable, the API returns 503 and writes the audit failure to server diagnostics; it cannot persist a database audit entry during that outage.

The JSON download contains `bloodUnits` (available and dispensed), `dispenseEvents`, `dispenseEventUnits`, `operationRequests`, all `auditLogs`, all eight inventory counts, and the application tables `schemaMigrations` and `inventoryLock`. Donor IDs remain strings, and donation dates remain `YYYY-MM-DD`. Logs are ordered by timestamp and then sequence. `formatVersion` identifies the export structure; `exportedAt` is the transaction start time.

All export reads share one PostgreSQL `REPEATABLE READ` transaction, so concurrent stock changes cannot produce contradictory tables in a copy. The export includes its own `RECORDS_EXPORTED` entry. That entry records generation of the copy, not confirmation that a browser saved the download. This implements the assignment's audit/export scope; it is not a claim of full regulatory certification.

## Allocation and data decisions

- Exact type first; then compatible alternatives by descending assignment population share, with O- last among alternatives.
- Requests may combine several compatible types. Insufficient total stock causes no dispensing: fulfillment is all-or-nothing.
- Oldest donations are issued first within each type. No expiry is modeled.
- One donation submission creates one unit. Donor IDs are stored as text and validated as 9 digits; checksum validation is not part of this assignment implementation.
- The backend rechecks stock on confirmation. Transactions serialize inventory writes so routine and emergency requests cannot issue the same units.
- Donation and dispensing writes use UUID `Idempotency-Key` headers. Retrying the same action with the same key returns the original receipt instead of issuing again.

## API

| Method | Route                       | Purpose                                                 |
| ------ | --------------------------- | ------------------------------------------------------- |
| GET    | `/api/health`               | Check database/schema connectivity                      |
| GET    | `/api/inventory`            | Available counts and the latest eight activities        |
| POST   | `/api/donations`            | Register one unit                                       |
| POST   | `/api/dispensing/preview`   | Preview an allocation without changing stock            |
| POST   | `/api/dispensing/confirm`   | Validate and issue the previewed allocation             |
| POST   | `/api/dispensing/emergency` | Issue all current O-negative stock                      |
| POST   | `/api/activities/cancel`    | Record a routine or emergency cancellation              |
| GET    | `/api/export`               | Download all application records and audit logs as JSON |

Runtime input validation is enforced on the API. Donation and dispensing writes require an `Idempotency-Key` UUID. Cancellation takes `{ "operation": "EMERGENCY" }` or `{ "operation": "ROUTINE", "recipientType": "A+", "quantity": 1 }`. Invalid input returns HTTP 400; oversized bodies return 413; stale allocations and empty emergency stock return 409. Database or audit unavailability returns 503.

## Assignment scope

This project follows the simplified compatibility and storage assumptions supplied in the assignment. It is an educational simulation, not a clinical transfusion system.
