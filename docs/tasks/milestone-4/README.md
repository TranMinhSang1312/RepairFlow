# Milestone 4 — Assignment, diagnosis, quote, and customer decision

## Business outcome

RepairFlow advances a newly received device through a controlled approval journey:

1. Owner or receptionist assigns an active technician.
2. The order enters `DIAGNOSING` only after assignment and intake evidence checks pass.
3. The assigned technician or owner publishes append-only diagnosis revisions.
4. Owner or receptionist creates a quote whose totals are calculated by the server.
5. Sending the quote freezes that version, creates a scoped public token, appends timeline/outbox records, and moves the order to `AWAITING_APPROVAL`.
6. The customer opens a public-safe page and records one idempotent decision.
7. An accepted decision moves the order to `APPROVED`; a declined decision moves it to `READY_FOR_PICKUP` with outcome `DECLINED_QUOTE`.

This is the first pilot-candidate journey. It must work without an AI provider or a real notification provider.

## Numbering note

The previous delivery combined identity and intake under `docs/tasks/milestone-2/` and used RF-010 through RF-019. This folder resumes the issue numbers reserved by `docs/implementation-plan.md` for diagnosis and quote work: RF-030 through RF-038.

## Scope

- Contract and persistence constraints needed by this milestone.
- Active-technician discovery, assignment, and reassignment.
- Central repair-order transition service with optimistic concurrency.
- Append-only diagnosis revisions.
- Draft quote versions and authoritative integer-VND totals.
- Quote send transaction, immutable sent versions, public token, timeline, and outbox.
- Public-safe order/quote read and idempotent customer decision.
- Staff workspace UI and customer public portal UI.

## Outside scope

- Work logs, parts usage, waiting-parts execution, QC, payments, handover, warranty.
- Real email, SMS, or Zalo delivery; this milestone uses `COPY_LINK` and a deterministic fake adapter boundary.
- Staff invitations, deactivation, or full membership administration.
- AI diagnosis, AI pricing, or AI-authored binding data.
- Customer accounts or chat.

## Contract decisions owned by RF-030

The current OpenAPI contract is not sufficient for the planned UI. RF-030 must make these decisions explicit before consumer code is implemented:

- Add a tenant-scoped read endpoint that lists active assignable technicians; this is discovery only, not staff management.
- Return an assignment representation from assignment creation.
- Return a diagnosis representation from diagnosis creation and expose diagnosis history in repair-order detail.
- Expose assignment and quote summaries required by the workspace.
- Add read/update operations for a `DRAFT` quote or explicitly define full replacement semantics. The selected design is `PATCH /api/v1/quotes/{quoteVersionId}` for draft-only replacement.
- Define dedicated public-safe quote schemas instead of reusing an internal staff schema.
- Define distinct invalid, expired, revoked, superseded, and already-decided behavior without revealing internal IDs.
- Add a database guarantee that one repair order has at most one active assignment.

No later RF may silently reshape these contracts. A required change must update RF-030's contract decision and all affected consumers in the same reviewed change.

## Dependency order

```text
RF-030 Contract and persistence alignment
    ├── RF-031 Assignment API
    └── RF-032 State-machine foundation
            └── RF-033 Diagnosis API
                    └── RF-034 Staff assignment/diagnosis UI
                    └── RF-035 Quote draft API
                            └── RF-036 Quote send, token, and outbox
                                    └── RF-037 Public read and decision API
                                            └── RF-038 Quote and public portal UI
```

RF-031 and RF-032 may be developed after RF-030 and in parallel only if they do not edit the same files. RF-035 through RF-037 are transaction-heavy and must be merged in order.

## Shared invariants

- Every staff operation validates bearer identity, active `X-Shop-Id` membership, role, and resource ownership.
- Cross-tenant resources behave as not found.
- Only the central state-machine service changes `RepairOrder.status`.
- Assignment, diagnosis, quote, token, approval, timeline, and outbox records preserve history.
- Sent or terminal quote versions are immutable.
- The server calculates money as integer VND and owns all status decisions.
- Raw public tokens appear only in the one-time URL response and are never stored or logged.
- Public responses exclude private notes, internal costs, audit payloads, staff identities, customer contact details, and object keys.
- Idempotent operations return the original result for the same request and reject a reused key with a different payload.

## Milestone acceptance criteria

- Owner/receptionist can assign or reassign an active technician in the same shop.
- A technician can see and diagnose only an actively assigned order; owner can diagnose any order in the shop.
- Invalid transitions and stale `lockVersion` writes are rejected without partial records.
- Diagnosis revisions are append-only and ordered safely under concurrency.
- Quote version numbers and totals remain correct under concurrent requests.
- Sending a quote atomically freezes it, creates a hashed scoped token, records timeline/outbox data, and changes status.
- Public reads expose only approved customer-safe data.
- Public decisions enforce token scope/expiry/version binding, approval groups, idempotency, and finality.
- The staff and public journeys work at a 360px viewport and expose useful loading, empty, error, conflict, and stale states.
- Format, lint, typecheck, test, build, migration deployment, and migration status all pass.

## Branch and PR order

Use one branch and PR per RF:

1. `feat/RF-030-contract-alignment`
2. `feat/RF-031-assignment-api`
3. `feat/RF-032-state-machine`
4. `feat/RF-033-diagnosis-api`
5. `feat/RF-034-web-assignment-diagnosis`
6. `feat/RF-035-quote-draft-api`
7. `feat/RF-036-quote-send`
8. `feat/RF-037-public-quote-decision`
9. `feat/RF-038-web-quote-portal`

Do not combine schema/OpenAPI edits from multiple RFs without explicitly reassigning file ownership.
