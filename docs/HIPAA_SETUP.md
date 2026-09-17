# HIPAA assignment extension

This implements the assignment's three roles while retaining the existing BECS workflows, transactional audit trail and electronic record copies. It is an educational simulation, not a certification of full HIPAA or FDA compliance.

## First administrator

1. Install dependencies (`npm ci`), configure `.env`, start PostgreSQL, and run `npm run db:migrate`.
2. Create the first administrator from PowerShell. The password is entered without echo and is not saved to the repository:

```powershell
$env:ADMIN_USERNAME = Read-Host 'Admin username (3-64 letters, digits, _, . or -)'
$env:ADMIN_DISPLAY_NAME = Read-Host 'Admin display name'
$adminSecret = Read-Host 'Temporary password (12-128 characters)' -AsSecureString
try {
  $env:ADMIN_PASSWORD = [System.Net.NetworkCredential]::new('', $adminSecret).Password
  npm run db:admin
} finally {
  Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $adminSecret.Dispose()
}
```

3. Optionally run `npm run db:seed` for 41 synthetic units. Existing seed receipts are retained, including those created before authentication existed; repeated seeding does not replenish issued units.
4. Run `npm run dev`, open [the app](http://127.0.0.1:5188), sign in, change the temporary password and sign in again.
5. Open **Users & audit** to create STAFF and RESEARCHER accounts. Each new account must change its temporary password. There is no self-registration or default administrator password.

Existing installations only need the new migrations and first-admin setup. Do not erase existing data or rerun old migration SQL manually. `db:admin` refuses to create another bootstrap account once an active admin exists.

## Roles and screens

| Capability | ADMIN | STAFF | RESEARCHER |
| --- | --- | --- | --- |
| Donation, routine and emergency dispensing | Yes | Yes | No |
| Operational inventory/activity | Yes | Yes | No |
| Annual research summary | Yes | Yes | Yes |
| Users, metadata/audit and complete record copies | Yes | No | No |

Researchers receive a separate server response containing only year, blood type and an approved aggregate count. Names, national IDs, unit/event IDs, exact dates and activity entries are never sent to that screen. Years already published are frozen permanently. New releases add completed years only; backdated records do not revise published years. Counts with fewer than five distinct donors (including zero) are suppressed. No complementary totals or arbitrary filters are available. These controls reduce disclosure risk; the threshold is not a legal de-identification guarantee.

The ADMIN **Records** view loads a readable, printable copy and offers JSON download. Each export is read from one repeatable-read database snapshot. Copies include donor records, issuance links, account identities and audit history, but exclude password hashes and session credentials. `EXPORT_REQUESTED` records an authorized request, not proof that a download completed.

## Authentication policy

- Salted scrypt password hashes; 12–128 characters for new passwords.
- Random server sessions; only the session token hash is stored in the database.
- HttpOnly, SameSite=Strict cookies; 15-minute inactivity and 8-hour absolute expiry.
- Authenticated writes require a session-bound CSRF token. Login requires a custom same-origin header; the server does not enable CORS.
- Login limits: 10 attempts per normalized username and 100 per IP per 15-minute window. Responses do not disclose whether a username exists.
- Logout removes the session. Role changes, disablement and password resets revoke all sessions for that user. The next request from another open tab is rejected; the UI also clears on its local expiry timer.
- Account changes retain before/after role and active state in the audit, with no password values. Accounts are disabled, never deleted through the app. Concurrent changes cannot remove the last active admin.
- Do not use actual donor information in a classroom demonstration.

## Restricted database account

The Compose example creates a database owner for convenience. **Use a separate runtime role when demonstrating database-level restrictions.** Application roles do not replace database privileges.

After migrations, run the following using the owner connection (in `MIGRATION_DATABASE_URL`, or the current owner `DATABASE_URL`):

```powershell
$env:RUNTIME_DB_USER = 'bloodbank_runtime'
$runtimeSecret = Read-Host 'New database password (at least 16 characters)' -AsSecureString
try {
  $env:RUNTIME_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $runtimeSecret).Password
  npm run db:runtime-role
} finally {
  Remove-Item Env:RUNTIME_DB_PASSWORD -ErrorAction SilentlyContinue
  $runtimeSecret.Dispose()
}
```

Set `DATABASE_URL` to the resulting role and password, URL-encoding special characters. Keep owner credentials separate and supply `MIGRATION_DATABASE_URL` only for administrative setup. The command refuses to overwrite an existing role. The runtime role can insert/read audit records but cannot update, delete, truncate, or disable their protection. It also cannot rewrite research snapshots. Triggers add protection against ordinary owner UPDATE/DELETE statements; a database superuser remains able to administer the database and must be controlled operationally.

Do not expose this local app publicly using plain HTTP. A deployed installation needs HTTPS and `COOKIE_SECURE=true` (also forced by `NODE_ENV=production`), protected database storage/backups, restricted infrastructure administration and an appropriate deployment review. Local HTTP development works with `NODE_ENV` unset.

## API additions

| Method | Route | Access |
| --- | --- | --- |
| POST | `/api/auth/login` | Login form with `X-Requested-With: BloodBank` |
| GET | `/api/auth/me` | Authenticated |
| POST | `/api/auth/logout` | Authenticated + CSRF |
| POST | `/api/auth/password` | Authenticated + CSRF; old and new password |
| GET | `/api/research/summary` | Any role, after password change |
| GET / POST | `/api/admin/users` | ADMIN |
| POST | `/api/admin/users/:id` | ADMIN; role, active and/or reset password |
| GET | `/api/admin/audit?page=0` | ADMIN; 50 records per page |
| GET | `/api/export` | ADMIN |

All original inventory/donation/dispensing paths remain. Read-only health is public. Unknown or forged roles never grant access. Unauthorized direct requests are rejected even if the caller constructs their own HTTP request.

## Verification

Run `npm test`, `npm run test:integration`, `npm run build` and `npm run format:check`. Integration tests require a **separate** database whose name ends in `_test`; they clear only their test data. The runtime-privilege test needs the test administrator to create a temporary role, as supported by the supplied Compose configuration. The migration test uses an isolated temporary schema inside that test database and removes it afterward.

The previous 16 operational integration scenarios now use real STAFF login sessions. Added tests cover role matrices, CSRF, session expiry/revocation, generic login errors/throttling, temporary passwords, last-admin races, actor-bound retries, research DTO fields and suppression, immutable releases, explicit record copies, append-only runtime privileges, audit failure rollback and legacy migration preservation.

For repeatable browser QA, build first, then run `npx tsx server/tests/browserPreview.ts`. It resets the separate test database, creates synthetic fixtures and listens only at `127.0.0.1:3012`. Its test-only accounts/password are defined in `server/tests/authHelpers.ts`. Never run integration tests simultaneously with this preview. Stop with Ctrl+C; it is not the normal application launcher and does not create accounts in the development database.

## Record retention and remaining regulatory scope

No audit/history purge is implemented. Operational owners must set a retention period appropriate to their record obligations and retain audit history at least as long as the associated records. Back up the full PostgreSQL database (not just JSON exports), including account mappings and research snapshots. Encrypt and restrict backups, test restoration into an isolated environment, and verify record counts, audit chronology, links and login behavior before approving recovery. Do not restore into the live database as a test.

The original assignment document covers the three BECS workflows; the available Part 11 write-up covers Audit Trail and Copies of Records. Both are preserved and strengthened. Broader Part 11 requirements—organizational procedures, training, formal validation and any legally binding electronic signatures—cannot be established from the supplied course materials or from login alone. There is no electronic-signature feature in this assignment extension. The Hebrew mapping states these limits explicitly.
