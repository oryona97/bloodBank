# BECS

An educational blood-bank simulation that manages donations, their components, laboratory clearance and dispensing.

## Blood products and laboratory work

**Donor**:
The person associated with one or more donations. Demonstrations use synthetic identities.

**Donation**:
A collection event associated with one donor, its collected blood type and its laboratory status.
_Avoid_: Unit, component

**Blood component**:
An individually identified product made from a donation or another component, with its own storage profile, expiry and disposition.
_Avoid_: Donation

**Product profile**:
A versioned definition of a product's storage requirements and shelf life.

**Quarantine**:
A restriction that prevents a donation's components from entering usable stock before laboratory clearance.

**Laboratory release**:
An explicit approval based on the complete required result set for a donation.
_Avoid_: Dispensing, issuing

**Result correction**:
A new revision of a previously recorded result that retains the original result's history.

**Available stock**:
Components that are laboratory-cleared, unexpired, unissued and assigned suitable storage.

**Dispensing**:
The issue of particular components from usable stock to a synthetic recipient or department reference.
_Avoid_: Laboratory release

**Processing**:
The production of components from a donation, or a derived product that consumes its source component.

**Discard**:
A recorded removal of an unissued component from usable stock, with a reason.

**Legacy component**:
A historic record whose product type, collection time or expiry was not recorded in the original model.

## Staff roles

**Operator**:
Staff responsible for donation intake, component production and reasoned disposal.
_Avoid_: Worker

**Laboratory staff**:
Staff responsible for laboratory results and approval or rejection of donations.

**Dispenser**:
Staff responsible for routine and emergency component issuance.

**Administrator**:
Staff responsible for accounts, product policies, audit access and full exports.

**Researcher**:
A user who receives aggregate inventory information without individual donor or laboratory records.
