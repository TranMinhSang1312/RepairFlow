# RepairFlow Product Specification

Status: proposed specification for `spec-v0.1`  
Audience: product, design, engineering, QA, and AI coding agents

## Product statement

RepairFlow is a multi-tenant operations system for independent phone, laptop, and tablet repair shops. It records custody of a device, coordinates diagnosis and customer approval, tracks repair work and quality control, and preserves evidence for handover and warranty.

RepairFlow is valuable without AI. AI reduces data-entry and communication time but never makes binding technical, pricing, approval, or warranty decisions.

## Problem

Small repair shops often coordinate work through paper receipts, chat messages, spreadsheets, and verbal updates. This creates recurring failures:

- The shop cannot prove the device's intake condition or included accessories.
- Staff cannot see who owns the next action.
- Customers approve a price in chat without a durable quote version.
- New costs arise during repair without a controlled re-approval flow.
- Technical notes are difficult for customers to understand.
- QC, handover, payment, and warranty history are fragmented.
- Owners cannot reconstruct who changed a case and when.

## Target customers

Primary target:

- Independent repair businesses with one to three branches.
- Three to thirty staff members.
- Repairs focused on phones, laptops, and tablets.
- Current process based on paper, spreadsheets, or general chat tools.

Initial pilot target:

- One real shop.
- One branch.
- One owner, one receptionist, and one or more technicians.
- At least fifty repair orders completed through the system.

## User roles

### Owner

Manages shop configuration, branches, memberships, reports, and all repair orders. The owner can perform receptionist actions but cannot bypass immutable business history.

### Receptionist

Creates customers, devices, intake records, photos, quotes, notifications, payments, handovers, and warranty follow-ups. The receptionist cannot perform a technical diagnosis or pass QC unless also granted the technician role in a later product version.

### Technician

Works on assigned repair orders, records diagnosis, logs repair work and parts used, and performs QC. A technician cannot record payments, hand over a device, manage members, or edit a sent quote.

### Customer

Does not create an account in the MVP. A customer uses a scoped public link to see an intentionally filtered timeline and decide the current quote.

## Core journey

1. The receptionist finds or creates the customer and device.
2. The receptionist records the reported problem, visible condition, included accessories, consent, and intake photos.
3. The system creates a shop-scoped order number and custody timeline event.
4. An owner or receptionist assigns a technician.
5. The technician records a diagnosis.
6. An owner or receptionist prepares and sends a versioned quote.
7. The customer opens a secure link and accepts, partially accepts valid optional items, or declines.
8. The technician performs only approved work and records work logs and parts.
9. If scope or price changes, the shop sends a new quote version and waits for a new decision.
10. Another eligible staff member or the assigned technician completes the configured QC checklist.
11. The receptionist records payment and handover.
12. The system creates warranty terms and closes the order.
13. A warranty return creates a new linked repair order instead of reopening history.

## MVP capabilities

### Included

- Email/password authentication and secure sessions.
- Shops, branches, memberships, and role-based access control.
- Customer and device records.
- Device intake with photos, condition, accessories, and consent.
- Repair-order board, search, filtering, assignment, and timeline.
- Append-only diagnoses.
- Immutable quote versions with required and optional items.
- Public quote decision and status tracking without customer login.
- Work logs and parts-used snapshots.
- Configurable QC templates and recorded QC runs.
- Basic payment records; no accounting ledger.
- Handover and warranty terms snapshot.
- Linked warranty repair orders.
- Transactional outbox and notification adapter.
- Audit log for privileged changes.
- AI OCR, intake draft, checklist suggestion, and customer summary behind feature flags after the core flow works.

### Explicitly excluded

- Marketplace or lead generation.
- Native iOS or Android applications.
- Appointment scheduling.
- Complete parts inventory, purchase orders, and supplier management.
- Payroll, tax, invoicing compliance, and accounting.
- Online payment gateway.
- Automated technical diagnosis or repair guarantee.
- AI-generated pricing.
- Customer chat platform.
- Elasticsearch, vector database, microservices, Kafka, or Kubernetes.

## Product principles

1. **Custody is explicit.** The system distinguishes stopping repair work from physically returning the device.
2. **Binding records are immutable.** Sent quotes, customer decisions, handovers, and timeline events are preserved.
3. **The customer sees less than staff.** Only public-safe facts and messages appear through public links.
4. **The server owns decisions.** Permissions, totals, transitions, token scope, and tenant ownership are computed server-side.
5. **AI is optional.** Provider failure cannot stop intake, quoting, repair, QC, or handover.
6. **Mobile-first operations.** Staff workflows must work from a phone camera and a small screen.

## Success criteria for the pilot

The pilot is successful when:

- At least 90% of new repair cases at the pilot shop are entered into RepairFlow.
- At least 80% of sent quotes receive a decision through the public portal rather than unstructured chat.
- Staff can locate the current owner and status of any active device in under thirty seconds.
- No completed order lacks a handover record.
- Every repaired outcome has a passing QC record.
- The shop reports fewer repeated status questions from customers.
- AI features, if enabled, save measurable entry or rewriting time without increasing correction errors.

## MVP completion criteria

The MVP is complete when a shop can execute the full core journey without a spreadsheet or paper process, and automated tests prove tenant isolation, role permissions, quote immutability, state-machine guards, idempotent customer decisions, QC gating, and safe public responses.

