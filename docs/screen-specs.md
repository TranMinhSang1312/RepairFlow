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
- Description, non-binding display note, quantity, unit, and unit price.
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
- A full-replacement draft may explicitly carry a prior item. The UI sends the prior item ID, never a scope key, and explains a rejected lineage without losing the draft.

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

- Approved snapshot scope displayed read-only with item, quantity/unit, and evidence coverage.
- Add timestamped repair/test work only while repairing; add customer-contact/internal notes in the documented operational states.
- Link technical work to an actionable approved item. Corrections target the current effective leaf and display earlier history as superseded.
- Record immutable used-part snapshots and corrections against an approved part; show cumulative effective quantity versus approval.
- Create part requirements and advance `NEEDED -> ORDERED|AVAILABLE` or `ORDERED -> AVAILABLE`. `CANCELLED` is read-only system history.
- Mark availability and request `WAITING_PARTS`/`REPAIRING` transitions when guards permit.
- Start new quote flow when scope or price changes.

Work logs cannot be edited in place. Correction creates a superseding entry.

## S08 — Quality control

### Content

- Active immutable template/version name and per-order run number.
- Required checklist items with pass/fail/not-applicable where permitted.
- Notes and optional evidence photo.

### Submission

- Owner settings can list template history, create the next version, and deactivate an active family; published checklist items cannot be edited in place.
- Submission includes `expectedLockVersion`; server derives overall result and advances the order version even when a passing run leaves the status unchanged.
- Failed result requires failure notes and returns the order to repair.
- Passed result enables the ready-for-pickup transition with outcome `REPAIRED`.

## S09 — Handover and warranty

### Fields

- Completion outcome, read-only from workflow.
- Authoritative approved total, paid total, amount due, and previously recorded payments.
- Add payment: amount, method, reference.
- Payment disposition: paid, partially paid, waived, or pay-later note.
- Recipient name, required.
- Optional signature/photo.
- Warranty end and terms for repaired outcomes; start is read-only and server-set to handover time.

### Completion

- Confirmation explains that physical custody will end and the order becomes terminal.
- Server records optional final payment, handover, repaired warranty, token revocation/new tracking link, completion, timeline, and domain outbox in one transaction.
- Replaying the same completion shows the same tracking URL until its expiry; an expired replay is terminal and asks staff to use a later separately contracted recovery flow.
- Owner/receptionist can open a warranty follow-up from an eligible completed order. The form confirms eligibility and captures fresh problem/condition, branch, accessories, and intake media; archived source profiles remain selectable through the immutable source snapshot.

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

