# RepairFlow Error Catalogue

All API errors use this envelope:

```json
{
  "error": {
    "code": "REPAIR_ORDER_INVALID_TRANSITION",
    "message": "The repair order cannot move to the requested state.",
    "requestId": "req_...",
    "details": [
      {"field": "targetStatus", "code": "INVALID_TRANSITION"}
    ]
  }
}
```

Messages may be localized. Client behavior must depend on stable `code`, not the message text.

## General

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `REQUEST_MALFORMED` | Body, query, or header cannot be parsed. |
| 401 | `AUTH_REQUIRED` | Access token is missing or invalid. |
| 401 | `SESSION_EXPIRED` | Refresh session is missing, expired, revoked, or reused. |
| 403 | `PERMISSION_DENIED` | Authenticated actor lacks the required permission. |
| 404 | `RESOURCE_NOT_FOUND` | Resource is absent from the active tenant or hidden by tenant isolation. |
| 409 | `CONCURRENT_UPDATE` | Optimistic lock version is stale. |
| 409 | `IDEMPOTENCY_KEY_REUSED` | The key was already used with different request data. |
| 422 | `VALIDATION_FAILED` | One or more input fields are invalid. |
| 429 | `RATE_LIMITED` | Caller exceeded the endpoint policy. |
| 500 | `INTERNAL_ERROR` | Unexpected server error; details remain server-side. |

## Identity and tenant

| HTTP | Code | Meaning |
|---:|---|---|
| 409 | `EMAIL_ALREADY_REGISTERED` | Registration email already exists. |
| 403 | `MEMBERSHIP_INACTIVE` | User has no active membership in the selected shop. |
| 404 | `SHOP_NOT_FOUND` | Selected shop is unavailable to the user. |
| 409 | `LAST_OWNER_REQUIRED` | Operation would leave the shop without an active owner. |

## Repair workflow

| HTTP | Code | Meaning |
|---:|---|---|
| 409 | `REPAIR_ORDER_INVALID_TRANSITION` | Requested state edge is not allowed. |
| 409 | `REPAIR_ORDER_GUARD_FAILED` | State edge exists but required business evidence is missing. |
| 409 | `TECHNICIAN_NOT_ASSIGNED` | Action requires the active assigned technician. |
| 409 | `INTAKE_PHOTOS_REQUIRED` | Shop-configured intake evidence is incomplete. |
| 409 | `COMPLETION_OUTCOME_REQUIRED` | Ready/completed transition lacks a valid outcome. |
| 409 | `QC_PASS_REQUIRED` | Repaired outcome lacks a latest passing QC run. |
| 409 | `HANDOVER_ALREADY_COMPLETED` | Order is already terminal. |

## Quotes and public access

| HTTP | Code | Meaning |
|---:|---|---|
| 409 | `QUOTE_NOT_DRAFT` | Only a draft quote can be edited or sent. |
| 409 | `QUOTE_IMMUTABLE` | Sent or terminal quote cannot be changed. |
| 409 | `QUOTE_SUPERSEDED` | A newer quote version replaced this one. |
| 409 | `QUOTE_ALREADY_DECIDED` | Binding decision already exists. |
| 422 | `QUOTE_ITEMS_REQUIRED` | Quote has no items. |
| 422 | `QUOTE_APPROVAL_GROUP_INVALID` | Selected items violate required group rules. |
| 404 | `PUBLIC_LINK_INVALID` | Token is invalid or revoked; response does not reveal which. |
| 410 | `PUBLIC_LINK_EXPIRED` | Token expired. |
| 410 | `PUBLIC_QUOTE_UNAVAILABLE` | Quote expired or was superseded. |

## Media, jobs, and AI

| HTTP | Code | Meaning |
|---:|---|---|
| 422 | `MEDIA_TYPE_NOT_ALLOWED` | MIME type is not on the allowlist. |
| 422 | `MEDIA_TOO_LARGE` | File exceeds configured size. |
| 409 | `MEDIA_UPLOAD_INCOMPLETE` | Intake references an upload not finalized. |
| 429 | `AI_BUDGET_EXCEEDED` | Shop AI usage budget is exhausted. |
| 503 | `STORAGE_UNAVAILABLE` | Private object storage is temporarily unavailable. |
| 503 | `AI_PROVIDER_UNAVAILABLE` | Provider is unavailable; manual flow remains usable. |
| 502 | `AI_OUTPUT_INVALID` | Provider output failed schema validation. |
| 409 | `AI_DRAFT_ALREADY_APPLIED` | The same draft cannot be applied twice. |

