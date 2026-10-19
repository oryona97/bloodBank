# Approved BECS project plan

The professor approved the final-project proposal; the user authorized TDD implementation on 2026-10-12. This plan supersedes the original whole-blood assignment. The approved scope includes component management and laboratory quarantine/release, expiry/FEFO, role separation, audit and migration safety.

See the [proposal](docs/proposal/BECS-project-proposal.he.docx), [implementation/validation](docs/proposal/IMPLEMENTATION.md), [architecture](docs/architecture.md), [glossary](GLOSSARY.md) and [README](README.md).

## Delivery checklist

- [x] Confirm public TDD boundaries with the user.
- [x] Separate donor/donation/component; preserve legacy history without invented clearance.
- [x] Version product profiles and assign storage locations.
- [x] Produce PRBC/FFP/Platelets; derive Cryo by consuming FFP.
- [x] Append immutable laboratory revisions and explicit release/rejection decisions.
- [x] Block quarantined, expired, incompatible and consumed components.
- [x] Preserve PRBC priorities; add product-specific compatibility and FEFO.
- [x] Issue requested eligible PRBC O− quantity in emergencies.
- [x] Separate five roles, including aggregate-only Researcher.
- [x] Remove authentication bypass/default secret; check active accounts and roles each request.
- [x] Add work queues, catalogue, expiry filters, discard, legacy completion and user controls.
- [x] Extend audit/exports, atomic mutation, idempotency and concurrency safeguards.
- [x] Provide repeatable synthetic seed and explicit demo accounts.
- [x] Verify 98 domain tests, 110 PostgreSQL tests and the production build.
- [x] Complete browser validation and documentation checks; results recorded in IMPLEMENTATION.md.

Excluded: ISBT identifiers/barcodes/lots, sensors, clinical crossmatch/reservations, full recall/lookback and clinical patient records. Policies are educational simulation assumptions.

## Historical baseline

The 2026-10-19 approved-plan audit corrections include mandatory collection time, approval reasons, product/type/status inventory, correct expiry reporting, donation component cards, explicit expiry bases, published laboratory panels, export audit consistency, missing U/I tests and named synthetic refresh batches. See [current verification](docs/verification/2026-10-19.md). The [audit](docs/reviews/approved-plan-audit.he.md) records the earlier findings.

The first assignment implemented intake, routine allocation, emergency dispensing, PostgreSQL audit and JSON export. Its 74 allocation tests were retained. Immediate availability, unlimited storage life, the broad Worker role and dispense-all emergency behavior were replaced by the approved requirements. Original screenshots remain historical materials under `docs/submission/`.
