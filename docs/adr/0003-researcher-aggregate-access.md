# Limit researcher access to aggregate inventory

The approved role model supersedes the individual de-identified researcher records described in ADR 0001. Researchers now use only inventory totals produced by SQL aggregation and cannot browse or export individual donations, components, laboratory records, receipts or audit entries. Removing those endpoints also avoids exposing stable record identifiers and nested details that deleting donor-name columns would not address.

Operational donation lists select only the fields needed for their role in the database query. The shared application database connection remains privileged; this is application RBAC with deliberately limited SQL projections, not PostgreSQL per-user RLS or a regulatory certification.
