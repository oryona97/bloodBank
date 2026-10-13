# Approved BECS implementation and validation

The professor approved `BECS-project-proposal.he.docx`. The user authorized implementation on 2026-10-12. Work is on branch `codex/becs-approved-expansion`. The approved document is preserved.

## Confirmed TDD boundaries

The user confirmed these boundaries on 2026-10-12:

- Exported domain functions for business rules, compatibility, expiry and allocation.
- HTTP API backed by real PostgreSQL for authenticated workflows, roles, audit/export, retries, concurrency and migrations. Assertions observe public responses rather than private database queries. SQL is used only to establish fixtures or inject database-boundary failures.
- Manual browser checks of screens, role-specific access and the complete workflow.

Features were developed as individual failing-test → minimal-implementation → passing-test slices. Review followed the implementation cycles. Examples include quarantine intake, component production, source consumption, release panels, correction invalidation, confirmation-time expiry, migrated stock, audit rollback and session revocation. Review also exposed a daylight-saving expiry error and a too-small confirmation payload limit; regression tests failed before both fixes and passed afterward.

## Delivered scope

- [x] Separate donors, donations and components; preserve legacy history without fabricated release results.
- [x] Manage PRBC, FFP, Platelets and Cryoprecipitate with versioned storage/expiry profiles and source consumption.
- [x] Quarantine new donations; record immutable result revisions and explicit laboratory release decisions.
- [x] Invalidate release when results change; block remaining available components immediately and flag already issued links in audit.
- [x] Product-specific compatibility, FEFO, expiry validation, routine and requested-quantity PRBC O-negative emergency dispensing.
- [x] Separate ADMIN, OPERATOR, LAB, DISPENSER and RESEARCHER; protect exports and recheck account status/role.
- [x] Remove authentication bypass/default secret outside explicit demo mode; rate-limit failed login attempts.
- [x] Extend inventory, filters, expiry reports, discard, audit, exports and user/catalogue controls.
- [x] Complete role-specific frontend, synthetic seed, documentation and local checks equivalent to the configured CI job.

Excluded: ISBT 128/barcodes/lots, cold-chain sensors, clinical crossmatch/reservations, full recall/lookback and clinical patient records. Storage classes and laboratory panels are fixed versioned catalogue entries; administrators can append expiry-policy versions. Existing components keep their original profile/expiry.

## Automated results — 2026-10-12

| Check                                      | Result                                                |
| ------------------------------------------ | ----------------------------------------------------- |
| Existing allocation domain tests           | 74 passed                                             |
| New component domain tests                 | 7 passed                                              |
| HTTP workflow/regression tests             | 15 passed                                             |
| HTTP component/laboratory tests            | 29 passed                                             |
| HTTP authentication/role tests             | 26 passed                                             |
| Legacy migration tests through HTTP        | 4 passed                                              |
| Total                                      | **155 passed: 81 domain + 74 PostgreSQL integration** |
| TypeScript and production build            | Passed locally and inside the Docker image            |
| Migration startup on preserved demo volume | Passed                                                |
| Repeat synthetic seed                      | Passed without duplicating or replenishing stock      |

Coverage includes missing/reactive/indeterminate results, typing mismatch, expiry at confirmation, FEFO, invalid storage, source consumption, stale/forged selections, all-or-nothing shortage, concurrent routine/emergency issue, idempotency conflicts/replays, lab corrections and terminal states, role denial, disabled/role-changed sessions, immutable history, preserved legacy IDs/links, verified legacy completion, audit rollback and consistent/filterable exports.

Additional audit checks prove that successful login retains account ID/role without credentials, laboratory-history reads identify the donation and actor, and account creation rolls back when its success audit fails. Simulated audit-failure diagnostics during the tests are expected.

Integration suites create and remove randomly named schemas in a separate `_test` database. They do not reset the development volume. GitHub Actions is configured to run formatting, domain tests, integration tests and build; remote CI has not been run for these unpublished changes.

## Browser verification — 2026-10-12

The rebuilt Compose application was checked at `http://localhost:3001` using all five demo roles.

| Scenario                                            | Observed result                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Operator intake                                     | Synthetic donation `897c43f7…` entered quarantine                                                               |
| Produce PRBC + FFP + Platelets                      | Three separate components, correct storage/expiry, all quarantined                                              |
| Missing-panel release attempt                       | Rejected with the required-results message                                                                      |
| Record matching typing and four negative screenings | Result history showed all five records; donation stayed quarantined until explicit approval                     |
| Explicit lab approval                               | PRBC available count increased from 41 to 42; its components became eligible                                    |
| Routine preview/cancel                              | Proposed 9 A+ PRBC; cancellation did not consume stock                                                          |
| Routine confirmation                                | Issued exactly 9 PRBC, including the new donation's red-cell component                                          |
| Emergency requested quantity                        | Issued exactly 1 PRBC O−; eligible O− stock decreased from 5 to 4                                               |
| Cryoprecipitate derivation                          | FFP source changed to Processed; new Cryo retained source link and source expiry                                |
| Reasoned discard                                    | New donation's Platelets became Discarded with the simulated-damage reason                                      |
| Researcher                                          | Only aggregate inventory navigation; no donor or laboratory work screens                                        |
| Administrator                                       | Versioned catalogue, storage/panel tables, expanded record collections and five-role account controls displayed |
| Browser full JSON export                            | Download completed; format 2 included new components/results/decisions and omitted password hashes              |
| Reload/restart                                      | Database counts persisted; generated demo-secret restart returned old sessions to sign-in                       |
| Responsive layout                                   | Desktop and 390px mobile inventory inspected; mobile document did not overflow horizontally                     |

The local volume's 43 original units remained preserved: 28 unissued units are quarantined with unknown legacy metadata and 15 stay issued. New synthetic component data is separate. No legacy release approval or collection timestamp was invented.

Screenshots are in [verification](../verification/). The full browser export was saved to the user's Downloads folder, outside the repository, and is not a source artifact.

## Final runtime verification — 2026-10-13

The previously interrupted check completed successfully. A reasoned HIV correction had changed the demonstration donation back to quarantine and blocked reapproval. Its remaining Cryoprecipitate component is quarantined; the PRBC stays Dispensed, the consumed FFP stays Processed and the Platelets stay Discarded. The immutable correction audit identifies `demo_lab`, role `LAB`, and flags the one already-issued component. Both Compose services are healthy, and the preserved data survived the overnight interval.

All 155 automated tests, the production build, formatting and whitespace checks passed again on 2026-10-13 against the current workspace. The final runtime check confirms the deployed local build's correction behavior through public HTTP responses.

## Reproduce

See [README](../../README.md) for setup, demo accounts, policies, routes and walkthrough. Run:

```sh
npm test
npm run test:integration
npm run build
npm run format:check
```

The implemented [architecture and ERD](../architecture.md), [glossary](../../GLOSSARY.md) and ADRs describe the delivered model. The original first-assignment submission guide is historical and does not describe the new clearance workflow.
