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
- **Canonical text key:** Unicode NFKC normalization, trim, collapse every whitespace run to one ASCII space, then locale-independent lowercase. Accents remain significant. Quote lineage uses this for description comparison; QC template families use it for `normalizedName`.

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
| `DIAGNOSING` | `READY_FOR_PICKUP` | Owner/receptionist only. `UNREPAIRABLE` or `NO_FAULT_FOUND` requires a tenant/order-bound diagnosis. `CUSTOMER_CANCELLED` requires a non-blank cancellation note and no sent/accepted/partially-accepted quote, payment, technical `REPAIR`/`TEST` log, or used part. |
| `AWAITING_APPROVAL` | `APPROVED` | Current quote is `ACCEPTED` or validly `PARTIALLY_ACCEPTED`; all required approval groups are satisfied. |
| `AWAITING_APPROVAL` | `DIAGNOSING` | Customer requests another option or staff supersedes the quote. |
| `AWAITING_APPROVAL` | `READY_FOR_PICKUP` | Quote is `DECLINED`; outcome is `DECLINED_QUOTE`. |
| `APPROVED` | `WAITING_PARTS` | At least one approved item requires an unavailable part. |
| `APPROVED` | `REPAIRING` | Active technician is assigned and approved scope exists. |
| `WAITING_PARTS` | `REPAIRING` | Required parts are marked available. |
| `REPAIRING` | `AWAITING_APPROVAL` | A new quote version with changed scope or price is sent. Work outside prior approval has not started. |
| `REPAIRING` | `QUALITY_CHECK` | Effective work evidence exists for every actionable approved `SERVICE` or `PART` item. |
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

1. The only authoritative approved scope is the latest binding `QuoteApproval.approvedItemSnapshot`. The server never reconstructs it from all quote items. No-charge work is represented by an accepted zero-price item.
2. Every quote item has a server-owned `scopeKey`. A full-replacement quote may carry a prior same-order key only when kind, normalized description, quantity/unit, approval group, and required/optional classification are unchanged. Price and non-binding `displayNote` may change. Invalid ancestry returns `QUOTE_SCOPE_LINEAGE_INVALID`, changes nothing, and produces a redacted audit entry; accepted lineage is audited too.
3. Work logs, requirements, and used parts bind to current approved lineage. `REPAIR` and `TEST` require an actionable approved item; operational notes are unlinked. A correction inherits the root semantic type and scope, may supersede only the effective leaf, and forms one immutable linear chain. Only the latest descendant is effective.
4. Part availability uses `PartRequirement`: `NEEDED -> ORDERED|AVAILABLE` and `ORDERED -> AVAILABLE` are staff actions. `AVAILABLE` is terminal. `CANCELLED` is terminal and system-only when a replacement approval removes that lineage.
5. `PartUsed` is append-only. Every API-created snapshot has both approved `quoteItemId` and `scopeKey`; nullable bindings exist only to preserve any pre-RF-040 database rows and those legacy rows never satisfy current coverage. A correction replaces the prior effective quantity for cumulative checks. Effective cumulative quantity cannot exceed the approved `PART` quantity; quantities are positive and prices are non-negative integer VND. MVP has no inventory ledger.
6. Changed scope, quantity, or sale price requires a replacement quote and binding decision before execution resumes.

### Execution command/state matrix

| Command | Allowed order states | Additional guard |
|---|---|---|
| Append/correct `REPAIR` or `TEST` | `REPAIRING` | Current approved actionable scope and technical authorization; correction targets effective leaf. |
| Append/correct `CUSTOMER_CONTACT` or `INTERNAL_NOTE` | `APPROVED`, `WAITING_PARTS`, `REPAIRING`, `QUALITY_CHECK`, `READY_FOR_PICKUP` | Operational only; never satisfies work coverage. |
| Create/update part requirement | `APPROVED`, `WAITING_PARTS`, `REPAIRING` | Current approved `PART` lineage; clients cannot set `CANCELLED`. |
| Append/correct used part | `REPAIRING` | Current approved `PART` lineage and effective quantity within approval. |

No execution write is accepted in `AWAITING_APPROVAL`, `RECEIVED`, `DIAGNOSING`, `COMPLETED`, or `VOIDED`. Every approved actionable `SERVICE` or `PART` item needs effective technical work evidence before `REPAIRING -> QUALITY_CHECK`.

## Quality-control rules

1. Template names have a canonical normalized family key. At most one version in a shop/family is active. Published versions/items are immutable; update creates the next version and deactivates the prior version atomically.
2. A run binds one active immutable template and contains every template item exactly once. `NOT_APPLICABLE` is valid only when the item permits it. Any failed item derives a failed run and requires a non-blank run note.
3. Every accepted submission allocates the next per-order `runNo` under the order lock and increments order `lockVersion`, including a pass that leaves status unchanged.
4. Failed QC persists the complete run and atomically returns the order to `REPAIRING`. A passed run leaves it in `QUALITY_CHECK`; a separate authorized transition sets `READY_FOR_PICKUP` and `REPAIRED`.
5. Latest QC is determined by `runNo`, not timestamp or UUID. Runs, results, and verified tenant/order-bound evidence are append-only.

## Payment and handover rules

1. Payment records are idempotent operational receipts, not an accounting ledger or tax invoice. The server derives `approvedTotal`, `paidTotal`, and `amountDue=max(0, approvedTotal-paidTotal)`; payments must be positive and not exceed due.
2. A standalone payment requires a binding approval and is allowed in `READY_FOR_PICKUP`, or in `COMPLETED` only after `PARTIALLY_PAID`/`PAY_LATER` handover while due remains. `PAID`/`WAIVED` handovers and all other states reject payment.
3. A valid non-repaired order without binding approval is zero/zero/zero and cannot receive payment. `PAID` requires zero due; `PARTIALLY_PAID` requires paid and due both positive; `WAIVED` and `PAY_LATER` require a note when due remains.
4. Handover is idempotent and allowed only from `READY_FOR_PICKUP` with `expectedLockVersion`. It atomically creates optional final payment, handover, repaired warranty, completion event/status, token mutations, domain-only outbox, and retained idempotency result.
5. A repaired handover requires warranty. The server sets `startsAt=handedOverAt`; the request supplies a later `endsAt` and non-blank terms. Non-repaired outcomes cannot create warranty.
6. The server validates signature media tenant, order, `SIGNATURE` purpose, completed upload, and expiry. Public payloads never contain signature/object metadata.
7. Completion revokes every active `DECIDE_QUOTE` and older `TRACK_ORDER` token and creates one TRACK token. Expiry is `max(handover+365 days, warranty end+30 days)` when repaired, otherwise `handover+365 days`.
8. Same-key/same-payload replay before expiry derives the same raw URL without storing it. Replay after expiry returns `TOKEN_EXPIRED` and never mints another token. Raw tokens are absent from database, logs, events, outbox, and persisted idempotency bodies.
9. The handover outbox payload contains domain identifiers only. Provider, channel, destination, and delivery retry are deferred to Milestone 6.

## Warranty rules

1. Warranty terms are immutable handover snapshots with server start, later end, and explicit text.
2. An idempotent warranty follow-up requires a same-tenant `COMPLETED` source covered at request time and explicit owner/receptionist confirmation. AI cannot approve eligibility.
3. The server creates a new `RECEIVED` order with a server code, `serviceType=WARRANTY`, `sourceOrderId`, exact copied source customer/device snapshots, and fresh intake fields/evidence. Archived live customer/device profiles remain eligible when they belong to the same shop.
4. The source order and all source-owned rows/events remain byte-for-byte unchanged. The relation and `warranty_case.opened` event are written only on the child.

## Public portal rules

1. Public tokens are high-entropy random values; only their hashes are stored.
2. Token scopes are `TRACK_ORDER` or `DECIDE_QUOTE`.
3. The portal exposes only allowlisted shop display/contact, order code/status/outcome, device display label, ready/returned timestamps, public timeline, the token-bound quote when applicable, customer-facing warranty dates/terms/status, and safe linked-order progress.
4. It never exposes payments, costs, staff identity, signature metadata, customer contacts, internal notes, object keys, source UUIDs, audit logs, AI prompts, provider responses, or other customers.
5. Token usage updates `lastUsedAt` but does not extend expiry automatically.
6. Quote-decision tokens bind to exactly one quote version.

## Audit and event rules

1. Order events are append-only and ordered by server timestamp and ID.
2. Each event has separate public and private payloads.
3. Audit logs record privileged CRUD and configuration changes, including actor and request ID.
4. Secrets and credentials must be redacted before audit serialization.
5. External effects triggered by a transaction are represented by an outbox event committed with that transaction.
