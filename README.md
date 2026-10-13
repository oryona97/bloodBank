# Blood Bank — BECS final project

Educational blood-bank simulation implementing the professor-approved expansion: blood components and laboratory quarantine/release, expiry, FEFO, separate roles, audit and exports. Use synthetic data. Storage and compatibility policies are project assumptions, not clinical protocols or regulatory certification.

See the [approved Hebrew proposal](docs/proposal/BECS-project-proposal.he.docx), [implementation and validation](docs/proposal/IMPLEMENTATION.md), [architecture and ERD](docs/architecture.md), [glossary](GLOSSARY.md), and [architectural decisions](docs/adr/).

## Implemented workflows

- Donations enter quarantine with a collection timestamp. An operator produces PRBC + FFP, optionally Platelets. Cryoprecipitate consumes an unissued FFP source, which cannot also be dispensed.
- Components reference immutable product-profile versions and assigned storage locations. Initial simulation profiles: PRBC 42 days at 1–6°C; FFP and Cryo 365 days at ≤−18°C; Platelets 5 days at 20–24°C with agitation. One day means 24 elapsed hours, including daylight-saving transitions. Cryo cannot outlast its source.
- Laboratory clearance requires matching ABO/Rh and negative HIV, HBV, HCV and syphilis results, followed by explicit approval. Missing, pending, reactive and indeterminate results block release. Results and decisions are append-only. Corrections require a reason and invalidate clearance, quarantining remaining available components; issued components are flagged in audit.
- PRBC allocation preserves exact-type/common-alternative/O−-last priorities. FEFO applies within type priority. Plasma uses ABO plasma compatibility, ignoring Rh. Platelets require exact ABO/Rh; Cryo requires exact ABO. The latter two are restricted simulation policies.
- Routine issue requires product, recipient type, quantity and synthetic recipient reference. Emergency issue takes a requested quantity of eligible PRBC O−. Both recheck clearance, expiry, storage and exact selection under the inventory lock. Shortages issue nothing. Retries do not repeat changes.
- Inventory shows product/type counts and status totals. Components support filters, pagination, seven-day expiry reports, discard with reason and verified legacy-detail completion.
- Administrators can revise expiry profiles without changing existing components, manage account roles/status, search records and export JSON. Storage classes and the laboratory panel are fixed versioned catalog entries. Sensors and measured cold-chain control are excluded.

## Run the local demo

With Docker running, from the repository root:

```sh
docker compose up --build -d
docker compose exec -T app node dist/server/server/scripts/seed.js
```

Open [the application](http://localhost:3001). Compose binds the app and PostgreSQL to localhost, applies migrations and reuses the named database volume. Stop with `docker compose down` to preserve data. Do not remove the volume when upgrading.

Compose explicitly defaults to `DEMO_MODE=true`. It creates these accounts only when missing:

| Username          | Password             | Role                                                    |
| ----------------- | -------------------- | ------------------------------------------------------- |
| `demo_operator`   | `DemoOperator123!`   | Register/process donations; manage/discard components   |
| `demo_lab`        | `DemoLab123!`        | Record/correct results; approve/reject release; discard |
| `demo_dispenser`  | `DemoDispenser123!`  | Routine and emergency issue                             |
| `demo_admin`      | `DemoAdmin123!`      | Users, expiry catalogue, audit/exports and read stock   |
| `demo_researcher` | `DemoResearcher123!` | Aggregate inventory only                                |

Roles do not inherit one another. Admin cannot approve laboratory results or dispense. Current account status and role are checked on every request; changed roles invalidate previous sessions.

The repeatable seed creates 41 synthetic donations and clears their components. In an empty new model it produces 41 PRBC, 33 FFP, 16 Platelets and 8 Cryo available components, plus 8 consumed FFP sources. Repeating it does not duplicate records or replenish issued/discarded stock. Legacy records retain their historical state.

In explicit demo mode, an omitted `JWT_SECRET` generates a random process secret; restart requires signing in again. Outside demo mode, provide a random secret of at least 32 characters and explicit `ADMIN_USERNAME`/`ADMIN_PASSWORD` for initial setup. Default accounts and authentication bypass are absent outside demo mode. Existing accounts are preserved.

## Upgrade an existing database

Migrations 005–010 preserve original IDs, dates, creation times, dispensing links and audit. Legacy available units become quarantined `LEGACY` components with unknown product, collection time, storage and expiry; issued units remain issued. No results or approval are invented. Broad `WORKER` accounts are disabled; an administrator can assign a new explicit role and enable them.

An operator can use **Complete verified details** on an unissued legacy component to record a documented product, collection timestamp matching its original date, and verification reason. Its ID is retained and it stays quarantined. Laboratory work and explicit approval remain mandatory. Cryo requires a documented FFP source and its separate processing workflow.

## Develop locally

Prerequisites: Node.js 24+, npm and PostgreSQL 17 (Compose is provided).

```sh
npm ci
```

Copy `.env.example` to `.env`, adjusting the database connection strings. The example enables the synthetic demo. Keep credentials out of Git. In PowerShell:

```powershell
Copy-Item .env.example .env
```

```sh
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run dev
```

Open [the development frontend](http://127.0.0.1:5188). Vite forwards `/api` to port 3001. Stop the Compose app before reusing its API port: `docker compose stop app`. For the built bundle run `npm run build` and `npm start`, then open port 3001. Migrate before restarting after upgrades.

## Verification

Create the separate test database once, if absent:

```sh
docker compose exec -T db createdb -U bloodbank bloodbank_test
```

Set `TEST_DATABASE_URL` in `.env`, then:

```sh
npm test
npm run test:integration
npm run build
npm run format:check
```

The user confirmed TDD boundaries at exported domain functions and HTTP endpoints with real PostgreSQL, plus manual browser checks. There are 81 domain tests and 74 integration tests covering compatibility/FEFO, quarantine, panels, corrections, confirmation-time expiry, storage, source consumption, retries, concurrent issue, role denial, disabled/stale sessions, migration preservation, audit rollback and consistent exports. Tests create/drop isolated schemas only, in a distinct database ending in `_test`.

GitHub Actions runs formatting, tests and build on push/PR. Local verification is recorded in [IMPLEMENTATION.md](docs/proposal/IMPLEMENTATION.md). Remote CI can be verified when the changes are published.

## Demo walkthrough

1. As operator, register a synthetic donation and produce components. Verify quarantine and exclusion from available stock.
2. As lab, select it and try release with missing tests. Record matching ABO/Rh and four negative screenings, then explicitly approve.
3. As dispenser, preview a compatible product request, cancel, preview again and confirm. Only confirmation changes stock. Shortages cannot be confirmed.
4. In **Emergency PRBC O−**, enter quantity and a synthetic reference. Only that many eligible O− red-cell components are issued.
5. As lab, append a correction with a reason. Remaining available components return to quarantine until another valid approval.
6. As operator, derive Cryo from FFP: its source becomes Processed. Inspect expiry filters or discard an unissued component with a reason.
7. As admin, inspect audit, donations, components, results, decisions, issue links, legacy records and request receipts. Selected/matching/full exports are audited. Full export format 2 includes new tables and user metadata, excluding password hashes.
8. As researcher, verify aggregate inventory only. Reload preserves database state.

## API boundaries

Except `/api/health` and `/api/auth/login`, endpoints require `Authorization: Bearer <token>`. Donation/component/lab/catalogue/account-update/issue mutations require a UUID `Idempotency-Key`; reuse with different operation or payload fails. User creation and cancellation retain single-operation behavior.

| Method and route                                                  | Authorized role                 | Purpose                                              |
| ----------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `GET /api/inventory`                                              | All                             | Aggregates; researcher receives no activity records  |
| `GET /api/donations`                                              | Operator, Lab, Admin            | Work list; identifying fields restricted to Operator |
| `POST /api/donations`                                             | Operator                        | Register in quarantine                               |
| `POST /api/donations/:id/components`                              | Operator                        | Produce template once                                |
| `GET /api/components`                                             | Operator, Lab, Dispenser, Admin | Filtered records                                     |
| `POST /api/components/:id/process`                                | Operator                        | Consume FFP and derive Cryo                          |
| `POST /api/components/:id/legacy-details`                         | Operator                        | Complete documented metadata, retaining quarantine   |
| `POST /api/components/:id/discard`                                | Operator, Lab                   | Discard with reason                                  |
| `GET/POST /api/donations/:id/lab-results`                         | Lab                             | History / append revision                            |
| `POST /api/donations/:id/release`                                 | Lab                             | Explicit approve/reject                              |
| `POST /api/dispensing/preview`                                    | Dispenser                       | Compatible FEFO proposal or shortage                 |
| `POST /api/dispensing/confirm`                                    | Dispenser                       | Recheck exact selection and issue                    |
| `POST /api/dispensing/emergency`                                  | Dispenser                       | Requested PRBC O− quantity                           |
| `POST /api/activities/cancel`                                     | Dispenser                       | Audited cancellation                                 |
| `GET /api/catalog`                                                | Operator, Lab, Dispenser, Admin | Profiles, locations and panel                        |
| `POST /api/catalog/products`                                      | Admin                           | Append expiry-policy version                         |
| `GET/POST /api/users`, `POST /api/users/:id`                      | Admin                           | View/create; role/status changes                     |
| `GET /api/records`, `POST /api/records/export`, `GET /api/export` | Admin                           | Audited records and exports                          |

Record searches treat text literally; date filters use inclusive Jerusalem days. Snapshot cutoffs exclude later records from pagination/exports. Mutable records can change, requiring refresh. Full copies use REPEATABLE READ and include their own export audit event.

Audit stores server time, sequence, request ID, action, outcome and actor/role. Append-only triggers protect audit, results, decisions and profiles. Database owners can change schemas/triggers. The application uses a shared database account with application RBAC. ISBT 128, lots/barcodes, cold-chain sensors, clinical crossmatch/reservations, patient records and full recall/lookback are excluded.

The [original submission guide](docs/submission/guide.he.html) is historical; its immediate-stock workflows predate this expansion.
