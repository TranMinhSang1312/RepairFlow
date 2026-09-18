# RepairFlow MVP Screen Specifications

Status: proposed specification for `spec-v0.1`

## Shared UX rules

- Staff UI is mobile-first and remains usable at 360 px width.
- Every screen shows the active shop and prevents accidental cross-shop work.
- Dates display in the shop timezone; API values remain ISO 8601 UTC.
- Money displays as VND and is entered as whole đồng.
- Destructive or binding actions show the resulting state before confirmation.
- Validation appears beside the field and uses stable API error codes.
- AI-generated values are labelled `AI draft` until accepted by a staff member.
- Customer-visible text is visually distinguished from internal notes.

## S01 — Sign in and shop selection

### Users

Owner, receptionist, technician.

### Fields

- Email, required and normalized.
- Password, required.
- Shop selector after login when the user has multiple active memberships.

### Actions

- Sign in.
- Refresh session automatically.
- Sign out from the current device.

### States

- Invalid credentials use a generic message.
- Disabled user or inactive membership cannot enter a shop.
- Rate-limit response shows a retry message without exposing account existence.

## S02 — Repair-order board

### Purpose

Show the current workload and next actions.

### Content

- Search by order code, customer phone/name, device model, serial, or IMEI.
- Filters: branch, state, assigned technician, priority, received date.
- Columns or mobile groups: received, diagnosing, awaiting approval, approved/waiting parts, repairing, QC, ready for pickup.
- Card fields: order code, device label, customer display name, state, assignee, age, priority, blocking reason.

### Actions

- Open order details.
- Start new intake.
- Assign/reassign where permitted.
- Refresh manually; MVP may poll every 30 seconds while visible.

### Empty/error states

- Explain active filters when no orders match.
- Preserve filters in the URL.
- Do not remove existing cards when polling fails; show stale-data warning.

## S03 — New intake

### Step 1: customer

- Search normalized phone.
- Select existing customer or create name, phone, optional email.

### Step 2: device

- Select existing device or create type, brand, model, color, optional serial and IMEI.
- Optional AI OCR fills a draft only.

### Step 3: intake evidence

- Reported problem, required.
- Visible condition, required.
- Accessories list with add/remove.
- At least the shop-configured number of intake photos.
- Data-risk/backup consent acknowledgement, required.
- Priority and optional promised date.
- Branch defaults to active branch.

### Submission

- Review summary before creation.
- Server returns order code and receipt view.
- Double submission is prevented by disabled action and idempotency key.
- Device PIN/password has no field in MVP.

## S04 — Repair-order workspace

### Header

- Order code, state badge, priority, branch, assigned technician, received time.
- Customer and device snapshot.
- State-aware primary action.

### Tabs

1. `Overview`: reported problem, intake condition, accessories, photos.
2. `Diagnosis`: revision timeline and new diagnosis form for eligible staff.
3. `Quote`: versions, current state, items, totals, send action.
4. `Work`: approved scope, work logs, parts used.
5. `QC`: template and run history.
6. `Handover`: payment, recipient, warranty, completion.
7. `Timeline`: public and internal events with visibility label.

### Behavior

- Only valid state actions are shown, but the API remains authoritative.
- Binding history is read-only.
- Concurrent update conflict reloads the current order and explains what changed.

## S05 — Quote editor and send

### Fields

- Diagnosis reference.
- Item type: service, part, fee.
- Description, quantity, unit price.
- Required/optional indicator and approval group.
- Discount in VND.
- Expiry date/time.
- Customer-facing note.

### Calculations

- Client previews totals; server recalculates and returns authoritative totals.
- Negative values are rejected.

### Send confirmation

- Shows version number, items, total, expiry, destination, and warning that the version becomes immutable.
- Successful send shows copy-link action even when notification provider is unavailable.
- Editing a sent quote starts a new draft version.

## S06 — Customer quote and tracking portal

### Access

No account. Token is read from the URL and never displayed back to the user.

### Content

- Shop name and contact.
- Order code and device display label.
- Public-safe current status and timeline.
- Current bound quote: items, required/optional labels, total, expiry, customer note.

### Decision

- Customer may accept all required scope, select permitted optional groups, or decline.
- A review panel shows the exact accepted items and authoritative total.
- Submission requires explicit confirmation and uses an idempotency key.
- After success the page becomes read-only and shows the recorded decision time.

### Token states

- Expired, revoked, superseded, already used, or invalid links get distinct user-friendly pages without exposing internal IDs.

## S07 — Work log and parts

### Users

Assigned technician and owner.

### Content/actions

- Approved quote scope displayed read-only.
- Add timestamped work-log entry.
- Link work to an approved quote item where applicable.
- Record part snapshot: name, SKU, quantity, cost, sale price.
- Mark part availability and request `WAITING_PARTS` transition.
- Start new quote flow when scope or price changes.

Work logs cannot be edited in place. Correction creates a superseding entry.

## S08 — Quality control

### Content

- Template/version name.
- Required checklist items with pass/fail/not-applicable where permitted.
- Notes and optional evidence photo.

### Submission

- Server derives overall result.
- Failed result requires failure notes and returns the order to repair.
- Passed result enables the ready-for-pickup transition with outcome `REPAIRED`.

## S09 — Handover and warranty

### Fields

- Completion outcome, read-only from workflow.
- Amount due and previously recorded payments.
- Add payment: amount, method, reference.
- Payment disposition: paid, partially paid, waived, or pay-later note.
- Recipient name, required.
- Optional signature/photo.
- Warranty start, end, and terms for repaired outcomes.

### Completion

- Confirmation explains that physical custody will end and the order becomes terminal.
- Server records handover, revokes active decision links, creates warranty, and transitions to `COMPLETED` in one transaction.

## S10 — Shop and staff settings

Owner only.

- Shop name, timezone, contact, order-code prefix.
- Intake photo minimum.
- Default quote expiry.
- Default warranty terms.
- Branch management.
- Staff invite, role, active/inactive state.
- QC template management.

Changing templates or default terms never rewrites historical snapshots.

