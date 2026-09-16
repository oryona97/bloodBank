# BECS assignment implementation plan

## Development checklist

### Submission materials

- [x] Capture application screenshots using synthetic demonstration data.
- [x] Write Hebrew explanations of the workflows, allocation strategy, and verification.
- [x] Package and review the screenshots and submission guide.
- [ ] Review the updated course slides when provided; final course-wide compliance remains pending.

Completed items use `[x]`. Items remain unchecked until implemented and verified.

- [x] Stage 0: Read the assignment and document the compatibility and rarity tables.
- [x] Stage 0: Choose TypeScript and PostgreSQL and connect the GitHub repository.
- [x] Stage 1: Scaffold the React frontend, Express backend, and shared TypeScript types.
- [x] Stage 2: Implement and test compatibility, rarity ranking, and allocation rules.
- [x] Stage 3: Add PostgreSQL migrations, seed data, and transactional API endpoints.
- [x] Stage 4: Build and verify donation intake and the inventory summary.
- [x] Stage 5: Build and verify routine allocation preview and confirmation.
- [x] Stage 6: Build and verify emergency O-negative dispensing.
- [x] Stage 7: Pass type checks, production build, domain tests, and PostgreSQL integration tests.
- [x] Stage 8: Verify the browser workflows and write setup and demo instructions.
- [x] Stage 9: Commit and push the working application and updated checklist.

**Status:** All baseline implementation stages are complete. The application is pushed to `main`, all 90 automated tests pass, and GitHub CI is green. The next step is to try the local app using the README demo walkthrough. Implementation follows the mixed-type, all-or-nothing allocation policy below.

### Verification record

- [x] 74 domain tests, including all 64 donor/recipient combinations.
- [x] 16 integration tests against a separate PostgreSQL database.
- [x] TypeScript checks and production build.
- [x] Browser donation: inventory increased from 41 to 42 units.
- [x] Browser routine preview: recommended 9 A+ and 1 O+; cancellation left inventory unchanged; confirmation issued 10 units.
- [x] Browser shortage: a 1,000-unit request reported a 980-unit shortfall with no dispense action.
- [x] Browser emergency: issued all 5 O-negative units; other types were unchanged and the empty-stock state appeared.
- [x] Browser reload retained the resulting 27-unit inventory.
- [x] Desktop and 390-pixel mobile layout inspected.
- [x] Setup, test commands, operating assumptions, and demo walkthrough documented in README.md.
- [x] Verify the first GitHub Actions run after publication: [successful run for application commit 542ac9e](https://github.com/oryona97/bloodBank/actions/runs/34967259415).

## Objective and scope

Project repository: [oryona97/bloodBank](https://github.com/oryona97/bloodBank). Keep the frontend, backend, database migrations, and tests in this one repository.

Build a student blood-bank application with three graphical screens, persistent inventory, and dispensing decisions based on the compatibility and population tables supplied in the assignment.

This plan implements the assignment's simplified simulation: eight blood types, whole-blood units, and unlimited storage life. Its compatibility table is an assignment rule, not a clinical transfusion protocol. Do not add expiry management, blood components, rare blood types, or clinical workflows unless the instructor approves the expanded scope.

The workspace initially contained the assignment document only. The user selected TypeScript and PostgreSQL. The proposed target is a browser application demonstrated on Windows; confirm whether the instructor requires a native executable. The deadline is not yet specified.

## Required screens

| Screen               | Inputs                                                         | Behavior and result                                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Donation intake      | Blood type, donation date, donor ID, full name                 | Validate input, record the donation, add one available unit, and show success and updated inventory. One submission equals one unit as a proposed simplifying decision.                |
| Routine dispensing   | Recipient/requested blood type, positive whole-number quantity | Prefer the exact type. When stock is insufficient, show a compatible allocation recommendation with quantities and an explanation. Update inventory when the user confirms dispensing. |
| Emergency dispensing | Emergency action                                               | Show the available O-negative quantity. On confirmation, dispense every available O-negative unit. If none remain, show an error without changing inventory.                           |

Show a small inventory summary on each screen. Three tabs in one window satisfy the three-interface requirement without needing separate applications.

## Assignment data

These values are transcribed from the supplied images and should be treated as fixed assignment data, rather than current population statistics.

| Recipient type | Allowed donor types              | Population share |
| -------------- | -------------------------------- | ---------------- |
| A+             | A+, A-, O+, O-                   | 34%              |
| O+             | O+, O-                           | 32%              |
| B+             | B+, B-, O+, O-                   | 17%              |
| AB+            | A+, A-, B+, B-, AB+, AB-, O+, O- | 7%               |
| A-             | A-, O-                           | 4%               |
| O-             | O-                               | 3%               |
| B-             | B-, O-                           | 2%               |
| AB-            | AB-, A-, B-, O-                  | 1%               |

Store compatibility as an explicit recipient-to-allowed-donors map. Use one shared function for all compatibility checks; never repeat the rules independently in the GUI.

## Proposed dispensing policy

The assignment requires compatibility and rarity to influence recommendations, but does not specify a unique optimization formula. The following deterministic policy is a proposed implementation choice.

1. Validate the recipient type and requested quantity.
2. Allocate available units of the exact type first, up to the requested quantity.
3. If more units are needed, filter remaining stock to compatible donor types only.
4. Put O-negative last among alternatives, preserving it for emergency use whenever another compatible option exists.
5. Rank other alternatives by population share, most common first, preserving rarer types. Use a fixed blood-type order to break any ties.
6. Allocate units in that order until the request is filled.
7. If compatible stock cannot fill the entire request, show the available quantity and shortfall. Do not dispense or modify stock.
8. Present the complete proposed allocation and reasons before confirmation. A preview or cancellation must not change stock.
9. On confirmation, recheck availability and commit the inventory changes and dispensing record together. If availability changed, refresh the recommendation.

Within each selected type, use the oldest donation first, with unit ID as a tie-breaker. This gives predictable behavior even though the assignment assumes no expiry.

### Example

An A+ recipient requests 4 units. Inventory contains A+: 1, O+: 2, A-: 2, O-: 5.

Recommend 1 A+, 2 O+, and 1 A-. This fills the request with compatible units, uses the exact type first, chooses the more common O+ alternative before A-, and preserves O-.

### Decisions to confirm against instructor expectations

- **Insufficient exact stock:** Treat both zero stock and insufficient stock as reasons to recommend alternatives.
- **Mixed donor types:** Allow one request to use several compatible types, as in the example. If the instructor requires a single alternative type, choose the highest-ranked compatible type with enough stock and show a shortfall if none can fill the request.
- **Partial fulfillment:** Default to all-or-nothing dispensing. Partial dispensing can be added later as an explicit user choice if required.
- **O-negative protection:** Place O- last among routine alternatives; do not impose a hard reserve threshold, since the assignment gives no reserve target. O- recipients still receive O- as their exact type.
- **Donation quantity:** One form submission records one unit; add a quantity field only if requested.

In the assignment's model, O- is compatible with every recipient type, which explains its role when recipient type is unknown in an emergency. Routine use reduces the stock available for that emergency operation.

## Application structure

Use TypeScript throughout: React and Vite with plain CSS for the frontend, a Node.js API using [Express](https://expressjs.com/), PostgreSQL for persistence, and Vitest for tests. TypeScript and PostgreSQL are confirmed choices; the frameworks are proposed. Vite provides a [React TypeScript template](https://vite.dev/guide/), and [Vitest](https://vitest.dev/guide/index.html) fits that toolchain.

Architecture: browser UI → TypeScript HTTP API → PostgreSQL. The API owns validation, allocation decisions, and all database writes. Keep database credentials in the backend's `DATABASE_URL` environment variable, never in frontend code.

Use three tabs rather than adding routing. Keep inventory in the persistence layer and refresh the UI after successful operations; a global state library is unnecessary for this scope.

Keep four responsibilities separate:

1. **GUI:** Forms, inventory display, validation messages, and confirmation dialogs.
2. **Domain rules:** Blood types, compatibility, rarity, and allocation planning; no GUI or database dependencies.
3. **Application services:** Register donations, preview routine allocations, confirm dispensing, and dispense emergency stock.
4. **Persistence:** Save and retrieve units and dispensing records; apply stock changes transactionally.

Use `pg` (node-postgres) with parameterized SQL, a connection pool, and versioned SQL migrations. Run PostgreSQL locally for development; document installation, database creation, migrations, and synthetic seed data. Keep separate development and test databases. Browser refreshes and browser storage cleanup do not affect the database.

### API endpoints

| Method and route                 | Purpose                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /api/inventory`             | Return available counts for all eight types, including zeros                         |
| `POST /api/donations`            | Validate and register one donated unit                                               |
| `POST /api/dispensing/preview`   | Return a routine allocation or shortage without changing stock                       |
| `POST /api/dispensing/confirm`   | Revalidate the submitted request and proposed allocation, then issue atomically      |
| `POST /api/dispensing/emergency` | Issue all O- available when the transaction selects inventory, or report empty stock |

Return field errors for invalid input and a conflict response when a routine preview is stale. Recompute compatibility and quantities on the server rather than trusting the submitted allocation. Use a unique request key for donation and dispensing writes; retries with the same key and payload return the original result, while reuse with different inputs is rejected.

### Implemented source layout

```text
client/src/
  api.ts
  App.tsx                    # Three screen components, inventory, and activity
  main.tsx
  styles.css
server/src/
  domain/
    compatibility.ts
    allocation.ts
    allocation.test.ts
  services/
    inventoryService.ts      # Transactions, donations, and dispensing
  storage/
    database.ts
    inventoryRepository.ts
    migrate.ts
  app.ts                     # API routes and error responses
  index.ts
  validation.ts
  errors.ts
server/migrations/
server/scripts/
server/tests/
shared/
  apiTypes.ts
```

Define `BloodType` as a union of the eight literal strings. Keep `planAllocation(recipientType, quantity, inventory)` pure: it returns either a proposed allocation or a shortage result and never writes to storage. Run the authoritative allocation logic on the backend.

### Transactions and simultaneous requests

For this small assignment, serialize inventory writes by locking a single dedicated `inventory_lock` row with `SELECT ... FOR UPDATE` at the start of each donation or dispensing transaction. Every inventory mutation must follow this convention. After acquiring the lock under READ COMMITTED isolation, read current stock, validate the allocation, and write the event, links, and unit statuses together. This simple approach prevents routine and emergency requests from consuming the same stock; it trades write throughput for straightforward correctness.

Keep user confirmation outside the transaction. A stale routine allocation returns a conflict and requires a refreshed preview. Emergency mode selects all current O- after acquiring the lock; donations committed afterward remain for the next operation.

Use `BEGIN`, `COMMIT`, and `ROLLBACK` on the same checked-out database client, releasing it in `finally`, as required by [node-postgres transactions](https://node-postgres.com/features/transactions). PostgreSQL [row locks](https://www.postgresql.org/docs/current/explicit-locking.html) last until the transaction ends. Record the request key and operation result in the same transaction for retry handling.

### Minimal data model

**BloodUnit**

- unit_id: unique internal identifier
- blood_type: one of the eight allowed values
- donation_date: validated date
- donor_id: text, preserving leading zeros
- donor_full_name: nonblank text
- status: AVAILABLE or DISPENSED

**DispenseEvent**

- event_id: unique identifier
- mode: ROUTINE or EMERGENCY
- recipient_blood_type: required for routine requests; empty for emergency mode
- requested_quantity: routine request quantity; empty for emergency mode
- issued_at: timestamp

**DispenseEventUnit**

- event_id and unit_id linking each issued unit to its event
- foreign keys to the event and blood unit tables
- UNIQUE(unit_id) so one unit cannot be issued twice

Compute stock from available units instead of keeping a second manually updated stock total. Updating unit status, inserting the event, and linking its units must succeed or fail as one transaction.

Use PostgreSQL `DATE` for donation dates, `TIMESTAMPTZ` for event timestamps, and text for donor IDs. Add NOT NULL and CHECK constraints for required fields, allowed blood types/statuses/modes, and positive routine quantities. Index available units by blood type, donation date, and unit ID. Add the single-row `inventory_lock` table and a request-deduplication table with a unique request key, operation, payload fingerprint, and saved result.

## Validation and user feedback

- Blood types come from a dropdown, not free text.
- Donor name and donor ID are required. Define the ID format explicitly; confirm whether the course expects an Israeli ID checksum.
- Donation date must be a valid date and cannot be in the future.
- Dispensing quantity must be a positive integer.
- The same donor can make multiple donations; a donor ID is not a unique donation ID.
- Disable repeat submission while saving to prevent duplicate clicks from issuing twice.
- Explain errors in the form and keep entered values so the user can correct them.
- Refresh inventory after every successful donation or dispensing operation.

## Implementation sequence

| Milestone                      | Work                                                                                           | Completion check                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1. Confirm design              | Scaffold React with TypeScript and Vite; confirm browser submission and dispensing assumptions | A short agreed scope and runnable empty app                                          |
| 2. Build rules                 | Add blood types, the compatibility table, rarity data, and a pure allocation function          | All compatibility combinations and representative allocations pass tests             |
| 3. Add backend and persistence | Set up PostgreSQL, migrations, seeds, Express routes, and transactional services               | API round trips work; data survives restart; failed operations leave stock unchanged |
| 4. Build intake screen         | Add input fields, validation, save action, and inventory summary                               | A valid donation increases the correct stock by one                                  |
| 5. Build routine screen        | Add request form, allocation preview, shortage messages, and confirmation                      | Exact-match, alternative, and insufficient-stock cases work                          |
| 6. Build emergency screen      | Add O- total and dispense-all action                                                           | Only O- is issued; a second attempt with zero stock reports an error                 |
| 7. Finish submission           | Run end-to-end scenarios; add setup instructions, policy explanation, and demo data            | The app runs on the chosen OS from documented instructions                           |

## Meaningful tests

- Verify all 64 donor/recipient combinations against an independently written expected matrix from the assignment.
- Confirm exact-type stock is preferred even when a more common alternative exists.
- Confirm an incompatible type is never recommended even if its stock is large.
- Verify the example allocation above and a case where O- is the only remaining compatible alternative.
- Verify that a request exceeding total compatible inventory produces a shortfall and no writes.
- Verify previews and cancellations leave inventory unchanged.
- Verify a stale preview cannot issue units already dispensed by another action.
- Verify emergency dispensing drains all O- stock and leaves every other type unchanged.
- Verify emergency dispensing at zero stock creates no dispensing event.
- Verify invalid inputs, repeated donations from the same donor, and persistence after restart.
- Verify transaction rollback prevents an event from being recorded with only some of its units issued.
- Run integration tests against a separate PostgreSQL test database, including concurrent routine and emergency requests, retry deduplication, and database constraints. Do not rely solely on mocked database tests.

## Submission checklist

- Source code and dependency/build instructions.
- PostgreSQL setup, environment-variable example without credentials, migrations, synthetic seed command, and frontend/backend startup instructions.
- Runnable application for the selected operating system, according to course submission rules.
- Brief explanation of compatibility rules, rarity ranking, and O- preservation.
- Explicit statement of decisions for mixed-type allocation and insufficient stock.
- Synthetic demo donors and a repeatable demo covering all three screens.
- Test results or documented verification scenarios.

## Scope to defer

Expiry dates, blood components, donor eligibility, infectious-disease testing, clinical matching, hospital integrations, authentication, dashboards, and deployment infrastructure are outside this first assignment implementation. The assignment explicitly requires advance instructor approval for expansion into a more realistic final project.
