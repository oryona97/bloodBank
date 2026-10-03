# Blood Bank

BECS student assignment for donation intake, routine blood dispensing, and emergency O-negative dispensing.

## Status

Donation intake, routine allocation and confirmation, emergency O-negative release, live inventory, and recent activity are implemented. PostgreSQL also stores an append-only audit trail. **Audit & records** provides a searchable record dashboard with selective exports and complete database copies as readable JSON. The system features **Role-Based Access Control (RBAC)** with JWT authentication, ensuring HIPAA compliance by scrubbing Protected Health Information (PHI) for restricted roles, and includes an Admin-exclusive **User Management** dashboard.

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

## Run with Docker Compose

With Docker running, execute this from the repository root:

```sh
docker compose up
```

Open [http://localhost:3001](http://localhost:3001). Compose builds the frontend and backend, waits for PostgreSQL to be healthy, applies pending migrations, and starts the app. No local Node.js installation or `.env` file is required. The database's existing named volume is reused, preserving inventory and audit history. A new database starts empty.

Use `docker compose up -d` to run in the background. After changing the source, use `docker compose up --build` to rebuild the app image. Stop the stack with `docker compose down`; data remains in the named volume. `docker compose down -v` deletes that data.

Optional synthetic demo data can be added once the app is running:

```sh
docker compose exec app node dist/server/server/scripts/seed.js
```

The seed is repeatable without duplicating donations or replenishing dispensed units. To change the browser port, set `APP_PORT` in `.env` (default `3001`). Compose uses `POSTGRES_PASSWORD` for both services; set it before initializing a new database volume. Changing it later does not change the existing database role's password. The host-side `DATABASE_URL`, `HOST`, and `PORT` settings are for local development and are not passed to the app container.

If switching from `npm start` or `npm run dev`, stop the local API first so port 3001 is available. Conversely, run `docker compose stop app` before starting the local API. The app container serves both the frontend and `/api` routes; port 5188 is only used by Vite during local development.

## Authentication & Roles

The system uses JWT-based authentication. On initial startup, the database migration automatically seeds three default users representing the different system roles:

- **Username:** `admin` / **Password:** `admin`
  - **Role: Admin** - Full access, including Audit Logs, User Management dashboard, and all inventory actions.
- **Username:** `worker` / **Password:** `worker`
  - **Role: Worker** - Can manage inventory (Deposit/Withdraw). No access to Audit Logs or User Management.
- **Username:** `researcher` / **Password:** `researcher`
  - **Role: Researcher** - Read-only access to aggregated inventory and PHI-scrubbed records (HIPAA compliant). No access to Audit Logs.

_Note: The default admin credentials can be overridden by setting `ADMIN_USERNAME` and `ADMIN_PASSWORD` in your environment._

## Develop locally

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
- 32 integration tests run against real PostgreSQL: the 16 original regression cases plus audit coverage, immutable history, rollback on audit failure, consistent exports, dashboard filtering, Jerusalem date boundaries, pagination, and selected-record exports.
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
7. Open **Audit & records** from the sidebar or **Audit & export records** above the inventory. Filter logs, open a row's **Details**, and check the rows to download. **Export selected** downloads just those rows; **Export all matches** includes every match across all pages. **Download full database** retains the complete export, including its own export event.

Reads and previews add audit entries without changing stock. Add synthetic donations through the intake screen to replenish stock for another walkthrough.

## Audit trail and copies of records

### Record dashboard

The fourth workspace screen lets you browse **Audit logs**, **Blood donations**, **Dispensing events**, **Issued units**, and **Request receipts**. Search matches literal text anywhere in a record, including IDs and nested details. Date filters include both endpoints and use the record's creation/issue time in `Asia/Jerusalem`; audit logs can also be filtered by action and outcome. Select **Apply filters** to run the search, or **Reset** to clear it. Rows are displayed newest first, with 20 per page.

Select individual checkboxes or the current page's header checkbox. Up to 200 explicitly selected records can be retained across pages. Changing the collection, applying filters, or refreshing clears the selection. **Export all matches** has no page-size restriction. The result cutoff is reused while paging/exporting to exclude subsequently created records; **Refresh records** loads newer activity. Mutable stock records can still change between viewing and exporting; selected records that no longer match return an error asking you to refresh.

All downloads contain two-space indentation and line breaks. A selective export includes its dataset, filters, scope, timestamp, count, and a `records` array containing only the chosen/matching rows. A complete copy keeps the original full-export structure described below. Dashboard access and both export scopes are audited. Audit history remains read-only; no editing or deletion controls are provided.

### Stored history and complete copies

The audit trail records donation registration, routine and emergency dispensing, inventory reads, allocation previews (including shortages), explicit routine/emergency cancellations, health checks, exports, rejected requests, and request retries. Successful stock changes and their audit records commit together. A failure to store the success audit rolls back the stock change. Rejected API requests are recorded after rollback, with their error code and status; malformed payloads are not copied into the audit trail.

Each new entry includes a database timestamp, sequence number, action, outcome, source, actor, and details. API entries also have a server-generated request ID (returned in `X-Request-Id`), HTTP method/path, and the supplied idempotency key when present. Donation entries identify the created unit; dispensing entries identify the event and every issued unit. Retries create `REQUEST_REPLAYED` entries without repeating the stock change. The UI waits for cancellation to be recorded before dismissing its confirmation.

API actions are authenticated via JWT, tracking the exact actor and their role for every operation. Seed and internal operations identify their system source. Browser-only interactions such as typing or changing tabs are not business records. Database triggers reject audit `UPDATE`, `DELETE`, and `TRUNCATE`; a database owner/administrator can still change the schema or disable triggers. If PostgreSQL is unavailable, the API returns 503 and writes the audit failure to server diagnostics; it cannot persist a database audit entry during that outage.

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

Except for `/api/health` and `/api/auth/login`, all endpoints require a valid JWT in the `Authorization: Bearer <token>` header.

| Method | Route                       | Purpose                                                 |
| ------ | --------------------------- | ------------------------------------------------------- |
| GET    | `/api/health`               | Check database/schema connectivity                      |
| POST   | `/api/auth/login`           | Authenticate and receive a JWT                          |
| GET    | `/api/inventory`            | Available counts and the latest eight activities        |
| POST   | `/api/donations`            | Register one unit                                       |
| POST   | `/api/dispensing/preview`   | Preview an allocation without changing stock            |
| POST   | `/api/dispensing/confirm`   | Validate and issue the previewed allocation             |
| POST   | `/api/dispensing/emergency` | Issue all current O-negative stock                      |
| POST   | `/api/activities/cancel`    | Record a routine or emergency cancellation              |
| GET    | `/api/export`               | Download all application records and audit logs as JSON |
| GET    | `/api/records`              | Filter and page through one record collection           |
| POST   | `/api/records/export`       | Export matching records or an explicit selection        |
| GET    | `/api/users`                | List all users (Admin only)                             |
| POST   | `/api/users`                | Create a new user (Admin only)                          |

Runtime input validation is enforced on the API. Donation and dispensing writes require an `Idempotency-Key` UUID. Cancellation takes `{ "operation": "EMERGENCY" }` or `{ "operation": "ROUTINE", "recipientType": "A+", "quantity": 1 }`. Invalid input returns HTTP 400; oversized bodies return 413; stale allocations and empty emergency stock return 409. Database or audit unavailability returns 503.

## Assignment scope

This project follows the simplified compatibility and storage assumptions supplied in the assignment. It is an educational simulation, not a clinical transfusion system.
