# BECS development context

The approved final-project scope and acceptance cases are in [docs/proposal/IMPLEMENTATION.md](docs/proposal/IMPLEMENTATION.md). Use [GLOSSARY.md](GLOSSARY.md) for canonical domain vocabulary.

- A donation is an intake event; a component is a product. Registering a donation does not add available stock.
- Laboratory release and dispensing are different actions performed by separate roles.
- Product profiles and result revisions are immutable; changing a result invalidates current clearance.
- All stock-related mutations, laboratory changes and policy revisions share the existing PostgreSQL inventory lock and transaction/audit convention.
- Researchers receive SQL-aggregated inventory only. Individual record browsing and full exports require administrator access.
- JWT authentication rechecks the current account role and active state. The old WORKER role is disabled until explicitly reassigned.
- This is an educational simulation with synthetic data. The project makes no regulatory compliance or clinical suitability claim.
- User-confirmed TDD boundaries are exported domain functions and the HTTP API with real PostgreSQL. Browser checks cover the UI. New assertions use those public boundaries.
