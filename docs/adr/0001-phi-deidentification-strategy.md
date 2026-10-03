# 0001-phi-deidentification-strategy

## Status

Accepted

## Context

HIPAA requires that we do not expose Protected Health Information (PHI), such as `donor_id` and `donor_full_name`, to unauthorized personnel like Researchers. However, Researchers still need access to the data for statistical analysis (e.g., counting total blood units of a certain type). We needed to decide where this De-identification filtering should happen.

Options considered:
1. **Application Layer Filtering**: The API server checks the user's role and redacts or removes the PHI fields before sending the JSON response.
2. **Database Layer Filtering**: Creating SQL Views that omit PHI columns and dynamically switching to these views for Researcher queries (or using PostgreSQL Row/Column Level Security).

## Decision

We chose **Database Layer Filtering** (e.g. SQL Views or RLS).

## Consequences

- **Positive**: More secure by default. Even if an API developer makes a mistake and queries the database, the database itself will refuse to return PHI for a researcher connection/context.
- **Positive**: Centralizes the access control in the data layer.
- **Negative**: Adds complexity to the SQL schemas and migrations.
- **Negative**: Requires the Node/Express backend to correctly set the database role or context parameter before executing queries on behalf of a user.
