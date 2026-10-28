# Screenshot audit — 28 October 2026

The original 16 PNG files in `docs/appScreens` were opened and visually inspected. Files were being renamed and removed during the review, so this audit uses the original capture timestamps and counts. The findings concern the images actually inspected, rather than an assumed screenshot for every role/page combination.

## Counts and overlap

- The original 16 screenshots cover all 9 distinct signed-in pages, at least partially.
- 7 images show Inventory: 5 upper-page captures and 2 lower-page captures.
- Keeping one upper and one lower Inventory capture removes 5 content repetitions. Role-specific sidebars still make some of the repeated upper captures useful as permission evidence.
- The 2 Blood components captures show different action sets and should both be retained: one includes Produce cryo and Discard; the other includes Discard only.
- The remaining 7 images each show a different page.
- A compact selection from the original set therefore has 11 images: 2 Inventory sections, 2 component action variants, and the other 7 pages. This is a content selection, not a complete workflow or role-permission evidence set.

## File-by-file review

The original filenames began with `Screenshot 2026-10-28 `; the short labels below are their timestamp suffixes. Some names have since changed. At a subsequent folder check, original captures 111401 and 111412 were no longer present. If 111412 remains absent, retain 111308 as the lower Inventory section and consider recapturing it without the notification.

| Image | Visible content | Recommendation |
| --- | --- | --- |
| `111254` | Inventory upper section, PRBC, Operator sidebar | Keep as the main Inventory view. |
| `111308` | Inventory lower section, Operator sidebar, Snipping Tool notification at the right | Repeats the tables in 111412. Prefer the cleaner 111412 for page content; retain this if Operator role context is needed. |
| `111330` | Donation intake form, production form and start of work list | Keep. Sidebar, selected donation details and action results are absent. |
| `111343` | Blood components, Discard and Produce cryo actions | Keep. Action set matches Operator, but the account label is cropped out. |
| `111401` | Inventory upper section, PRBC, Lab sidebar | Optional for page content; useful evidence of Lab navigation. |
| `111412` | Complete PRBC blood-type/status table and all-product status overview | Keep as the lower Inventory section. Sidebar is cropped out. |
| `111420` | Laboratory queue and donation list, no donation selected | Keep. Result entry, release decision and result history are not visible until a donation is selected. |
| `111424` | Blood components with Discard but without Produce cryo | Keep as the second action variant. Action set matches Lab; account label is cropped out. |
| `111439` | Inventory upper section, PRBC, no sidebar | Optional; repeats Inventory content and does not establish which account was signed in. |
| `111450` | Inventory upper section, PRBC, Dispenser sidebar | Optional for page content; useful evidence of Dispenser navigation. |
| `111457` | Routine dispensing initial form | Keep. No allocation preview, shortage, cancellation or success is shown. |
| `111502` | Emergency dispensing initial form and available O-negative count | Keep. No confirmation, cancellation, shortage or success is shown. |
| `111523` | Inventory upper section, PRBC, Admin sidebar | Optional for page content; Admin navigation is also visible in 111530 and 111534. |
| `111530` | Audit & records controls, export buttons and first audit row | Keep. Other collections, expanded details, lower rows/pagination and export results are absent. |
| `111534` | Product policies, Create profile version form and storage locations | Keep. Required laboratory tests and panel publication section below are cut off. |
| `111538` | User summary, Add New User and first directory rows | Keep. Lower directory rows and action results are not covered. |

## What to have at the end

### For a page overview

- [x] Every signed-in page appears at least once.
- [ ] Add the Login page.
- [ ] Capture Inventory as Researcher with both `demo_researcher` and the Inventory-only navigation visible. No existing image visibly establishes the signed-in Researcher role. The Researcher row in User management is not equivalent evidence.
- [ ] Add a Blood components view as Admin or Dispenser with the account label visible and no management actions. The current two component images both show Discard.
- [ ] Include the sidebar/account label when documenting the Operator and Lab component action differences.
- [ ] Select a donation in Laboratory and cover the revealed details, result form, release decision and history.
- [ ] Cover the lower catalogue section: required laboratory tests and panel publication controls.
- [ ] Cover the relevant lower sections and expanded details on Donation intake, Audit & records and User management. A readable full-page image or multiple sections can do this; every row of a long repeated table does not need its own screenshot.

### For a workflow demonstration

The existing images primarily show initial forms and lists. Add evidence of the states that matter to the demonstration:

- [ ] Inventory product-specific views for FFP, Platelets and Cryoprecipitate. Current selected-product views are all PRBC; the all-product overview does not show the other products' blood-type breakdowns.
- [ ] Donation registration success, component production and linked donation/component details.
- [ ] Laboratory blocked release, completed test panel, successful approval and a correction with history and renewed quarantine; rejection if documenting that workflow.
- [ ] Routine allocation preview, confirmed issue, cancellation and insufficient stock.
- [ ] Emergency confirmation, successful issue and shortage; cancellation if documenting that workflow.
- [ ] Component filters/expiry report and discard form/result. Existing images already show an FFP in Processed status and Cryo with its source link; add action feedback if demonstrating the processing operation itself.
- [ ] The record collections needed by the report, expanded record details and successful exports. The detailed checklist lists all 10 collections, including potentially empty historical collections.
- [ ] Catalogue version/panel changes and user creation/role/status changes, if demonstrating those operations.

Use [the detailed screenshot checklist](screenshot-checklist.he.md) for the exhaustive state list. Keep the selected product, relevant controls, account role and result message visible. Avoid notification overlays and use a consistent viewport/zoom for new captures.

The audit process did not rename, edit or delete any screenshot; observed file changes occurred independently.
