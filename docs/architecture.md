# Implemented architecture

React/TypeScript screens call an Express HTTP API. The server owns validation, role checks, compatibility, selection and PostgreSQL writes. Browser storage holds the session; stock, history and retry receipts persist in PostgreSQL.

Product profiles include an explicit product-specific `expiry_basis` (COLLECTION or SOURCE_EXPIRY), used by the expiry calculation. `lab_panels` records immutable publication metadata; both `donations.required_panel_version` and `lab_test_types.panel_version` reference it. Publishing and intake share the inventory lock, so a donation retains the latest complete published panel. Earlier donations keep their original requirements and result references.

```mermaid
flowchart LR
  UI[Role-specific React screens] --> API[Authenticated Express API]
  API --> Rules[Pure component and compatibility rules]
  API --> Services[Transactional services]
  Services --> PG[(PostgreSQL)]
  API --> Reads[Role-specific record projections]
  Reads --> PG
```

## Workflow

```mermaid
flowchart TD
  Intake[Operator: register donation] --> Q[Quarantine]
  Q --> Split[Operator: produce components]
  Split --> Lab[Lab: record required panel]
  Lab --> Decision{Explicit Lab decision}
  Decision -->|Acceptable complete results| Released[Released donation / eligible components available]
  Decision -->|Missing or unacceptable results| Block[Issue blocked]
  Decision -->|Reject with reason| Reject[Donation rejected / stock blocked]
  Released --> Preview[Dispenser: compatible FEFO preview]
  Preview --> Confirm{Recheck after inventory lock}
  Confirm -->|Valid exact selection| Issued[Event + links + Dispensed]
  Confirm -->|Changed or expired| Conflict[Reject / refresh preview]
  Released --> Correction[Lab: append correction with reason]
  Correction --> Q
  Split --> Cryo[Consume unissued FFP / derive Cryo]
  Split --> Discard[Operator or Lab: discard with reason]
  Released --> Discard
```

## ERD

```mermaid
erDiagram
  donors ||--o{ donations : supplies
  donations ||--o{ blood_components : produces
  component_types ||--o{ blood_components : profile_version
  storage_locations ||--o{ blood_components : assigned_storage
  blood_components o|--o{ blood_components : source_component
  donations ||--o{ lab_results : tested
  lab_test_types ||--o{ lab_results : panel_test
  lab_results o|--o| lab_results : replaces_revision
  donations ||--o{ release_decisions : clearance_history
  lab_panels ||--o{ donations : required_panel
  lab_panels ||--|{ lab_test_types : contains
  users ||--o{ lab_panels : published_by
  users ||--o{ lab_results : recorded_by
  users ||--o{ release_decisions : approved_by
  users ||--o{ dispense_events : issued_by
  dispense_events ||--o{ dispense_event_components : issues
  blood_components ||--o| dispense_event_components : issued_once
  donors {
    uuid donor_id PK
    text demo_identifier UK
    text full_name
  }
  donations {
    uuid donation_id PK
    uuid donor_id FK
    date donation_date
    timestamptz collected_at "nullable for legacy"
    text initial_type
    text verified_type
    text lab_status
    int required_panel_version
    timestamptz processed_at
  }
  blood_components {
    uuid component_id PK
    uuid donation_id FK
    uuid type_id FK
    uuid source_component_id FK
    uuid location_id FK
    timestamptz expires_at "nullable for legacy"
    text status
    text discard_reason
  }
  component_types {
    uuid type_id PK
    text code "unique with policy_version"
    int policy_version
    int expiry_days
    text expiry_basis
    text storage_class
    numeric min_c
    numeric max_c
    boolean agitation
  }
  storage_locations {
    uuid location_id PK
    text label
    text storage_class
  }
  lab_test_types {
    uuid test_type_id PK
    text code "unique with panel_version"
    int panel_version
    text result_kind
    boolean required
  }
  lab_panels {
    int panel_version PK
    timestamptz published_at
    uuid published_by FK
    text reason
  }
  lab_results {
    uuid result_id PK
    uuid donation_id FK
    uuid test_type_id FK
    int revision
    text value
    timestamptz performed_at
    timestamptz recorded_at
    uuid recorded_by FK
    uuid replaces_result_id FK
    text reason
  }
  release_decisions {
    uuid release_id PK
    uuid donation_id FK
    uuid_array result_version_refs "exact result IDs"
    text decision
    uuid approved_by FK
    text reason
    timestamptz approved_at
  }
  dispense_events {
    uuid event_id PK
    text product_type
    text mode
    text recipient_blood_type
    text recipient_reference
    int requested_quantity
    uuid issued_by FK
    timestamptz issued_at
  }
  dispense_event_components {
    uuid event_id FK
    uuid component_id FK,UK
  }
  users {
    uuid id PK
    text username UK
    text password_hash
    text role
    boolean active
  }
```

`operation_requests` stores the UUID key, operation, fingerprint and original receipt. `inventory_lock` supplies the one-row lock. `audit_logs` stores actor/role, action, outcome, server time, sequence and request metadata with append-only protection. `schema_migrations` tracks SQL versions. Release decision result references are stored as an immutable UUID array rather than a separate join table.

Legacy `blood_units` and `dispense_event_units` remain preserved historical tables. New operations use donations/components. Missing legacy product/time/expiry remains unknown; unissued components stay quarantined and historical issued links are preserved.

All stock, lab, catalogue and account-update mutations acquire the shared lock, read current data under READ COMMITTED and commit state/event links, audit and retry receipt together. This favors clear correctness over concurrent write throughput. Full exports use a REPEATABLE READ snapshot. See [ADR 0002](adr/0002-donations-components-and-laboratory-clearance.md) and [ADR 0003](adr/0003-researcher-aggregate-access.md).
