# RepairFlow RBAC Matrix

Status: proposed specification for `spec-v0.1`

## Roles

- `OWNER`
- `RECEPTIONIST`
- `TECHNICIAN`
- `CUSTOMER_TOKEN` is a public-token scope, not a staff membership role.

An inactive membership has no access. A user may belong to multiple shops and may have a different role in each shop.

## Permission matrix

Legend: `A` allowed, `O` allowed only for an assigned order, `—` denied, `T` allowed only by a valid scoped customer token.

| Capability | Owner | Receptionist | Technician | Customer token |
|---|:---:|:---:|:---:|:---:|
| View shop settings | A | — | — | — |
| Edit shop settings | A | — | — | — |
| Manage branches | A | — | — | — |
| Invite/deactivate staff | A | — | — | — |
| View staff membership | A | A | — | — |
| View customers/devices | A | A | O | — |
| Create/update customer | A | A | — | — |
| Create/update device | A | A | — | — |
| Archive customer/device | A | A | — | — |
| Create intake/order | A | A | — | — |
| Upload intake media | A | A | O | — |
| View all repair orders | A | A | — | — |
| View assigned repair order | A | A | O | T |
| Assign/reassign technician | A | A | — | — |
| Start diagnosis | A | — | O | — |
| Publish diagnosis revision | A | — | O | — |
| Create quote draft | A | A | — | — |
| Edit draft quote | A | A | — | — |
| Send/supersede quote | A | A | — | — |
| View internal price/cost | A | A | O | — |
| Decide current quote | — | — | — | T |
| Start approved repair | A | — | O | — |
| Add work log | A | — | O | — |
| Record parts used | A | — | O | — |
| Submit QC run | A | — | O | — |
| Override failed QC | — | — | — | — |
| Mark ready after passing QC | A | A | O | — |
| Record payment | A | A | — | — |
| Complete handover | A | A | — | — |
| Create warranty follow-up | A | A | — | — |
| View public progress | — | — | — | T |
| View audit logs | A | — | — | — |
| View business reports | A | — | — | — |
| Run AI assistance | A | A | O | — |
| Accept AI draft into form | A | A | O | — |

## Assignment rule

`O` means all of the following are true:

- The order belongs to the active shop.
- The technician has an active membership in that shop.
- The technician has an active assignment for the order.
- The action is valid for the current state.

## Public-token scope

| Scope | Allowed operations |
|---|---|
| `TRACK_ORDER` | Read one filtered order, public timeline, handover readiness, and warranty summary. |
| `DECIDE_QUOTE` | Read one filtered order and one bound quote version; submit one idempotent decision before expiry. |

A `TRACK_ORDER` token cannot decide a quote. A `DECIDE_QUOTE` token cannot access another quote version or repair order.

## Server enforcement

1. Authentication identifies the user.
2. `X-Shop-Id` selects a shop but grants no permission by itself.
3. A tenant guard validates active membership and builds tenant context.
4. A permission guard checks the action and role.
5. The application service checks resource ownership, assignment, state, and domain guards.
6. The repository includes shop scoping in every query.

UI visibility is not an authorization control. Every denied action must also be rejected by the API.

