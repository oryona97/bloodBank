# Domain Glossary

- **Worker**: A staff member in the blood bank who has permissions to deposit and withdraw blood units. (Replaces the generic term "User" to avoid ambiguity).
- **Researcher**: A research student who can query the system for data.
- **Admin**: A system administrator who can manage accounts and view system metadata/logs.
- **PHI (Protected Health Information)**: Information that can identify a patient/donor (e.g., `donor_id`, `donor_full_name`). 
- **De-identification**: The process of hiding PHI from unauthorized roles (like Researchers). In this system, it is implemented via **Database Layer Filtering** (the database itself omits or restricts access to these columns based on the user's role).
- **Aggregated Statistics**: Summarized data that does not identify individuals (e.g. total units of A+ blood). Safe for Researchers to view under HIPAA.
- **Audit Trail**: A chronological Part 11 log of who did what and when. Only Admins can view this.
- **Authentication**: We use a **Username & Password** login system that returns a JWT. The JWT is then used to track the exact **actor** in the Audit Trail for every action.
- **Initial Admin**: The very first Admin account is created automatically on server startup by reading **Environment Variables**.
- **UI Permissions**:
  - **Admin**: Full access, including Audit Logs and User Management.
  - **Worker**: Can manage Inventory (Deposit/Withdraw), no access to Audit Logs.
  - **Researcher**: Read-only access to Inventory (Aggregated) and Records (PHI scrubbed), no access to Audit Logs.
