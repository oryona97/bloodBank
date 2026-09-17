# HIPAA extension: implementation plan and recovery checkpoint

Last checkpoint: 2026-09-17.

## Current state — read this first

- Implementation is complete; final verification and checkpoint cleanup are in progress.
- Backend, UI, migrations, setup scripts and Hebrew submission explanation are written.
- Verified so far: 74 baseline domain tests, 31 integration tests (16 original + 15 security), production build. A new isolated-schema migration test is awaiting the final run.
- Browser verified with synthetic test data: researcher restricted summary, staff donation (6→7 units), routine dispense (7→6), emergency (6→5, O-negative 1→0), admin users/audit and readable full export.
- Browser inspection revealed a calendar-date serialization issue; export now casts donation_date to text, with a regression assertion. Retest this final change.
- No development database migrations, user accounts or runtime roles have been created. All execution used the separate test database. User-owned submission file moves remain untouched.
- Documentation: docs/HIPAA_SETUP.md and docs/submission/part3/hipaa_explanations.he.md. README links updated.
- Next: stop the synthetic browser preview, run final suites/build/format, update results below. Production setup requires the user to choose their admin and database passwords using the documented commands.

## Resume protocol for the implementing agent

1. Read this file and applicable AGENTS.md instructions; inspect `git status --short` and `git diff` before edits.
2. Preserve unrelated user changes. At planning time, old files under `docs/submission/` were deleted and `docs/submission/part1/` and `part2/` were untracked. Do not undo or stage these as your work.
3. Before each phase, update the checkpoint below with the intended edits. After each coherent change, record files changed, commands run, actual results, and the exact next action.
4. If interrupted unexpectedly, inspect actual files and diffs: an unchecked step may be partially implemented. Do not blindly reapply edits or migrations.
5. Use small, verifiable changes. Mark a phase complete only when its acceptance checks pass. Record failing/pre-existing checks explicitly.
6. Never store passwords, session tokens, or .env contents in this document. Do not reset databases or remove user data to resume.
7. Continue from the first unfinished phase. No need to repeat repository discovery or request approval for routine implementation decisions. Do not automatically commit, push, or deploy.

## Objective and scope

Extend the existing React/TypeScript/Express/PostgreSQL BECS application with login and ADMIN, STAFF, RESEARCHER roles. Preserve previous donation, routine dispensing, emergency O-negative dispensing, audit trail, and record export behavior for authorized users.

The previous Part 11 documentation describes audit trail and copies of records only; it does not establish full regulatory compliance. Map the actual previous assignment requirements to implementation and verification. Document any gaps; login is not an electronic signature. If signatures are part of the course requirements, explicitly plan signature meaning, identity, timestamp, and binding to the signed record. Do not claim full HIPAA/Part 11 compliance from role checks alone.

## Agreed planning defaults

| Capability                                          | ADMIN | STAFF | RESEARCHER |
| --------------------------------------------------- | ----- | ----- | ---------- |
| Register donations; routine/emergency dispensing    | Yes   | Yes   | No         |
| Operational inventory and activity                  | Yes   | Yes   | No         |
| Donor information needed for operations             | Yes   | Yes   | No         |
| Research summaries                                  | Yes   | Yes   | Yes        |
| Audit/metadata and full record export               | Yes   | No    | No         |
| Create, disable, reset passwords, change user roles | Yes   | No    | No         |

- Researcher is read-only. Metadata means actor, action, timestamp, affected record, and outcome; it may contain sensitive information and is admin-only.
- Admin can perform every supported application action, but cannot erase or rewrite audit history.
- No new address, birth-date, health-condition, or payment fields are needed merely because the assignment lists PHI categories. Protect the data this application actually holds.
- No public signup. Bootstrap the first admin through a setup command with no hardcoded password.
- Disable accounts rather than deleting their identity/history. Prevent removal of the last active admin, including concurrent requests.

## Repository findings

- `server/src/app.ts`: all current endpoints lack authentication. `/api/export` exposes all donor records. Existing API responses use Cache-Control: no-store.
- `server/src/services/inventoryService.ts`: inventory writes and audit insertion share a transaction; global inventory row lock serializes mutations. Preserve rollback, concurrency and retry guarantees.
- Idempotency currently uses a global request UUID plus operation/payload fingerprint. Bind requests/results to the authenticated actor and check authorization before returning cached results; never allow one user's key to reveal another user's receipt. Preserve legacy requests without inventing an owner.
- `server/src/storage/exportRepository.ts`: uses SELECT * and separate concurrent queries. Replace with explicit fields and a consistent database snapshot; never export password hashes or sessions.
- `server/migrations/001_initial.sql`: blood_units includes donor_id, donor_full_name and donation_date, plus unit UUID; operation_requests holds cached responses.
- `server/migrations/002_audit_trail.sql`: audit_logs contains action, JSON details and timestamp, no actor. Donation audit details currently include donor PHI.
- `server/src/storage/migrate.ts`: applies ordered SQL files transactionally and records filenames. Add migrations; do not rewrite already-applied migrations.
- `client/src/App.tsx`: existing operational interface and Export Records link.
- `shared/apiTypes.ts`: shared DTOs. Define separate research DTOs; do not serialize full records and hide fields in React.
- `server/tests/api.test.ts`: existing integration helpers send unauthenticated requests; adapt them to real authenticated test sessions, not an auth bypass.
- `docs/submission/part2/part11_explanations.he.md`: existing Hebrew Part 11 explanation.

## Implementation phases

### 0. Baseline and requirements

- [x] Review previous assignment requirements and document a requirement-to-test mapping for retained Part 11 behavior and known gaps.
- [x] Run npm test, npm run test:integration, npm run build, npm run format:check. Record actual outcomes; DB integration requires the separate configured test database.
- [x] Inspect existing test isolation before changing audit privileges/schema. Preserve user database contents.

### 1. Identity and sessions

- [x] Add users/sessions migrations: unique normalized username, password hash, role constraint, active status, timestamps, session expiry/revocation. Keep secrets out of DTOs.
- [x] Secure salted password hashing, server-side opaque sessions, HttpOnly/SameSite cookies, Secure under HTTPS, CSRF protection, idle and absolute expiry, login throttling, generic authentication errors.
- [x] Add login/logout/me and password-change flow; revoke sessions on password reset, account disablement, or role change.
- [x] Add safe first-admin bootstrap command and documented configuration, without default credentials.

### 2. Authorization and actor attribution

- [x] Central authentication and role middleware, default-deny for protected routes; 401 for unauthenticated, 403 for forbidden.
- [x] Apply the permission matrix to every route, including export, preview, emergency dispensing and future admin/research endpoints.
- [x] Obtain actor identity from the session, never from request-body role/user fields.
- [x] Bind idempotency to the actor, preserving retry and duplicate-prevention guarantees and defining handling for legacy unowned keys.

### 3. Audit and record copies

- [x] Add actor identity and role-at-action to audit events. Mark historical records as legacy/unattributed; never fabricate identities.
- [x] Retain inventory and audit atomicity. Record administrative changes atomically with their audit entries too.
- [x] Record login/security failures, logout, denied access and export events without passwords/tokens or unnecessary PHI. Security failure events must survive the rejected operation's rollback.
- [x] Use a non-owner runtime database role with append-only audit privileges; separate migration/test administration. No admin UI for changing/deleting audit records.
- [x] Admin-only paginated metadata/audit display and full export from a consistent snapshot, with explicit fields and human-readable/printable records as well as electronic copies.
- [x] Preserve legacy records and exports; document record retention/backup and restore requirements without claiming these are solved by login.

### 4. Research projection

- [x] Dedicated `/api/research/summary`, repository query and DTO; never reuse full inventory activity, audit, donor or export responses.
- [x] Only approved aggregates such as blood-type/year donation totals. Exclude names, national IDs, unit/event IDs, exact dates, activity logs and links to source records.
- [x] Define suppression for small groups and complementary totals, fixed query dimensions and controlled snapshot refresh to reduce differencing attacks. Choose and document a concrete policy during implementation; a numeric threshold alone does not establish HIPAA de-identification.
- [x] No arbitrary drill-down or real-time operational inventory for researchers. Validate the entire returned payload, not just visible UI columns.

### 5. User interfaces

- [x] Login/logout, identity/role indicator, session-expiry handling and clearing sensitive in-memory state on logout/account switch.
- [x] Preserve existing operational screens for STAFF and ADMIN.
- [x] Admin user management and audit/metadata screens, including last-admin safeguards and forced password change after reset.
- [x] Research-only interface for RESEARCHER with explanatory labels for suppressed/delayed aggregates.

### 6. Verification and submission

- [x] All previous allocation, shortage, cancellation, emergency, persistence, concurrency and retry tests pass with authenticated actors.
- [x] Direct API tests for every role/route, forged role fields, cross-user idempotency keys, forbidden exports, researcher writes, and missing/expired/revoked sessions.
- [x] Verify logout, role/account change revocation, CSRF, login throttling and last-admin constraints.
- [x] Verify research responses contain no forbidden fields; test small groups, complementary totals and snapshot policy.
- [x] Verify audit attribution, legacy preservation, append-only runtime permissions, atomic rollback and consistent complete export excluding auth secrets.
- [ ] Finish verification of the newly added isolated-schema legacy migration test (synthetic data); fresh migrations already passed.
- [x] Run relevant tests, build, formatting and browser walkthrough for each role. Record any environment blockers rather than claiming tests passed.
- [x] Update README/setup instructions and Hebrew submission explanation with requirement-to-evidence mapping. Browser screenshots inspected in-session; no new screenshot files saved.

## Verification commands

```text
npm test
npm run test:integration
npm run build
npm run format:check
```

Use existing .env configuration privately. The integration runner expects a distinct database ending in `_test`; do not point it at the development database. Inspect available services before starting new ones.

## Reference sources consulted during planning

- HHS de-identification: https://www.hhs.gov/hipaa/for-professionals/special-topics/de-identification/index.html
- HHS Security Rule overview: https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html
- 21 CFR Part 11: https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11

## Latest working checkpoint

- Active phase: final verification; application implementation complete.
- Files: new auth modules, migrations 003–005, runtime role/bootstrap scripts, research repository, AuthApp role UI, modified app/service/export/client API, authenticated regression and security/migration tests, setup/submission docs.
- Test/build status: 31 integration tests and production build passed before final date-export fix and migration test. Final commands still required.
- Temporary process: synthetic browser preview started on 127.0.0.1:3012 with test DB; stop before integration tests. No development DB changes.
- Remaining external scope: original course-wide Part 11 rubric not supplied; available prior write-up covers audit and copies. Electronic signatures, organizational validation, training, deployment encryption and retention procedures are documented limitations, not implemented claims.
- Resume prompt: "Read HIPAA_IMPLEMENTATION.md, inspect existing changes, and continue from the latest checkpoint. Keep it current after each coherent change."
