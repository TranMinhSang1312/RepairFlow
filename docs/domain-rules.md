# RepairFlow Domain Rules

Status: proposed specification for `spec-v0.1`

## Shared terminology

- **Shop:** tenant that owns business data.
- **Branch:** physical operating location inside a shop.
- **Repair order:** custody and workflow record for one device visit.
- **Quote version:** immutable commercial proposal for a repair order.
- **Public token:** hashed, scoped credential that allows a customer to view one order or decide one quote.
- **Completion outcome:** reason the device became ready for return.
- **Timeline event:** append-only business event used for traceability and customer-safe progress.
- **Audit log:** staff/security change record that is never exposed to customers.

## Tenant rules

1. Every business record belongs to one shop.
2. A request has no tenant context until the API validates that the authenticated user has an active membership in the selected shop.
3. Branches, customers, devices, users assigned to work, quotes, and child records must belong to the same shop as the repair order.
4. A record from another shop must behave as not found. The API must not reveal whether it exists.
5. Owners may access every branch in their shop. Receptionists and technicians may be restricted by branch membership in a later version; the MVP grants their role across the shop.

## Customer and device rules

1. Customer phone numbers are stored in raw display form and normalized form for search.
2. A customer can own multiple devices and a device can have multiple repair orders over time.
3. Serial and IMEI are text values and are not globally unique.
4. A repair order stores customer and device snapshots at intake so historical receipts do not change when profiles are edited later.
5. Customer and device profiles may be archived but are not hard-deleted when referenced by repair history.

## Repair-order state machine

### States

| State | Meaning |
|---|---|
| `RECEIVED` | The shop has accepted custody of the device. |
| `DIAGNOSING` | A technician is investigating the reported problem. |
| `AWAITING_APPROVAL` | A current quote has been sent and requires customer action. |
| `APPROVED` | The current quote decision permits repair work to begin. |
| `WAITING_PARTS` | Approved work is blocked by unavailable parts. |
| `REPAIRING` | Approved repair work is in progress. |
| `QUALITY_CHECK` | Repair work is complete and awaiting QC. |
| `READY_FOR_PICKUP` | The device can be returned, regardless of whether it was repaired. |
| `COMPLETED` | Physical handover is recorded and custody has ended. |
| `VOIDED` | A duplicate or erroneous record was voided before real custody began. |

### Completion outcomes

`READY_FOR_PICKUP` and `COMPLETED` require one of:

- `REPAIRED`
- `DECLINED_QUOTE`
- `UNREPAIRABLE`
- `NO_FAULT_FOUND`
- `CUSTOMER_CANCELLED`

### Allowed transitions and guards

| From | To | Required conditions |
|---|---|---|
| `RECEIVED` | `DIAGNOSING` | Intake condition is present; required intake photos exist; an active technician is assigned. |
| `RECEIVED` | `VOIDED` | Record is erroneous, no real device custody exists, and no quote/payment/work log exists. Owner only. |
| `DIAGNOSING` | `AWAITING_APPROVAL` | A current quote version is `SENT` and has at least one item. |
| `DIAGNOSING` | `READY_FOR_PICKUP` | Outcome is `UNREPAIRABLE` or `NO_FAULT_FOUND`; a diagnosis exists. |
| `AWAITING_APPROVAL` | `APPROVED` | Current quote is `ACCEPTED` or validly `PARTIALLY_ACCEPTED`; all required approval groups are satisfied. |
| `AWAITING_APPROVAL` | `DIAGNOSING` | Customer requests another option or staff supersedes the quote. |
| `AWAITING_APPROVAL` | `READY_FOR_PICKUP` | Quote is `DECLINED`; outcome is `DECLINED_QUOTE`. |
| `APPROVED` | `WAITING_PARTS` | At least one approved item requires an unavailable part. |
| `APPROVED` | `REPAIRING` | Active technician is assigned and approved scope exists. |
| `WAITING_PARTS` | `REPAIRING` | Required parts are marked available. |
| `REPAIRING` | `AWAITING_APPROVAL` | A new quote version with changed scope or price is sent. Work outside prior approval has not started. |
| `REPAIRING` | `QUALITY_CHECK` | Work logs exist for every required approved repair group. |
| `QUALITY_CHECK` | `REPAIRING` | Latest QC run failed. Failure notes are recorded. |
| `QUALITY_CHECK` | `READY_FOR_PICKUP` | Latest QC run passed; outcome is `REPAIRED`. |
| `READY_FOR_PICKUP` | `COMPLETED` | Handover recipient, staff actor, timestamp, and payment disposition are recorded. |

`COMPLETED` and `VOIDED` are terminal. Warranty work creates a new order with `sourceOrderId` referencing the original completed order.

### Transition transaction

Every transition must occur through one domain service and one database transaction:

1. Lock or optimistically version-check the repair order.
2. Re-read relevant guard data.
3. Verify actor permission.
4. Update status, outcome, timestamps, and `lockVersion`.
5. Append an `order_event`.
6. Append any required `outbox_event`.
7. Commit.

No generic endpoint may patch the `status` field.

## Intake rules

1. Creating a repair order requires customer, device, branch, reported problem, intake condition, and consent acknowledgement.
2. Required intake photo count is configured per shop; MVP default is one.
3. Accessories are explicit records or structured items, never buried only in free text.
4. The server generates the order code. Clients cannot choose it.
5. The intake event records the staff actor and customer/device snapshots.
6. Device unlock credentials are outside MVP and must never be placed in intake notes.
7. Intake media is uploaded as a short-lived unbound asset. Creating the repair order verifies ownership, MIME, size, upload completion, and expiry, then binds the asset in the same transaction.

## Diagnosis rules

1. Only an assigned technician or owner can publish a diagnosis.
2. Published diagnoses are append-only.
3. Corrections create a new revision that references or supersedes the prior revision.
4. AI may draft findings or checklists but cannot publish a diagnosis.

## Quote rules

### Statuses

`DRAFT`, `SENT`, `ACCEPTED`, `PARTIALLY_ACCEPTED`, `DECLINED`, `EXPIRED`, `SUPERSEDED`.

### Invariants

1. A draft quote contains at least one item before it can be sent.
2. Quantity must be positive; unit price and discount cannot be negative.
3. The server calculates line totals, subtotal, discount, and total.
4. Money is integer VND.
5. Sending a quote creates an immutable snapshot, increments `versionNo`, creates scoped public access, and supersedes any prior active sent version.
6. A sent quote cannot be edited or deleted.
7. Required items must be accepted together. Optional items may be independently accepted if their `approvalGroup` constraints remain valid.
8. A customer decision is final for that version. A change requires a new quote version.
9. A decision endpoint is idempotent. Repeating the same key returns the original result; reusing the key with different input returns an idempotency conflict.
10. An expired, revoked, or superseded token cannot decide a quote.

## Work and parts rules

1. Work can begin only for approved quote scope unless the recorded item is explicitly no-charge and authorized.
2. Work logs are append-only and identify their author and time.
3. Corrections use a new log with `supersedesId`.
4. Parts used are snapshots of name, SKU, quantity, cost, and sale price. MVP does not promise real-time inventory.
5. New scope or cost requires a new quote before work begins on that scope.

## Quality-control rules

1. A QC run records the version of its template and every required result.
2. A run is `PASS` only if all required items pass.
3. Failed QC returns the order to `REPAIRING` with failure notes.
4. Outcome `REPAIRED` cannot reach `READY_FOR_PICKUP` without a latest passing QC run.
5. QC history is append-only.

## Payment and handover rules

1. Payment records are operational receipts, not an accounting ledger or tax invoice.
2. Payment amount must be positive and created idempotently.
3. A handover records recipient name, staff actor, time, payment disposition, and optional signature media.
4. `COMPLETED` means physical custody ended. Declining a quote does not complete an order.
5. Completing handover revokes active customer approval tokens and any temporary device credential if a future version supports one.

## Warranty rules

1. Warranty terms are snapshotted at handover.
2. A warranty has start and end timestamps and explicit text terms.
3. A return under warranty creates a new repair order with `serviceType=WARRANTY` and `sourceOrderId` referencing the original.
4. The original order remains immutable and completed.
5. Warranty eligibility is confirmed by authorized staff; AI cannot approve or reject it.

## Public portal rules

1. Public tokens are high-entropy random values; only their hashes are stored.
2. Token scopes are `TRACK_ORDER` or `DECIDE_QUOTE`.
3. The portal exposes customer-safe status, order code, device display label, public timeline messages, current quote, and warranty summary.
4. It never exposes internal notes, cost price, staff email, audit logs, AI prompts, provider responses, or other customers.
5. Token usage updates `lastUsedAt` but does not extend expiry automatically.
6. Quote-decision tokens bind to exactly one quote version.

## Audit and event rules

1. Order events are append-only and ordered by server timestamp and ID.
2. Each event has separate public and private payloads.
3. Audit logs record privileged CRUD and configuration changes, including actor and request ID.
4. Secrets and credentials must be redacted before audit serialization.
5. External effects triggered by a transaction are represented by an outbox event committed with that transaction.
