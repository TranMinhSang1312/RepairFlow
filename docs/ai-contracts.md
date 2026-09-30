# RepairFlow AI Contracts

Status: active specification for `spec-v0.1` and capability-specific prompt versions

## Purpose

AI capabilities reduce repetitive entry and rewriting. They do not diagnose a device, price work, approve a quote, change workflow state, decide warranty, or write directly to domain tables.

## Execution contract

1. Global `AI_ENABLED` and the active shop's capability flag must both be enabled.
2. An authorized, idempotent staff request locks the capability's UTC usage period, reserves the maximum run cost, creates an `ai_runs` row with `QUEUED` status, and creates `AI_RUN_REQUESTED_V1` in one transaction.
3. The outbox payload contains only `schemaVersion`, `aiRunId`, `shopId`, and `capability`; the API returns `202` with the run ID and never calls the provider.
4. A worker rechecks authorization and loads only the authorized input required for the capability.
5. The worker redacts prohibited personal or secret data.
6. The provider-neutral AI Gateway calls the configured adapter with a versioned prompt and JSON schema.
7. Output is parsed and validated. Invalid output is failed, never partially applied.
8. A successful output is stored in `ai_runs.output` and displayed as an `AI draft`.
9. A staff member explicitly accepts, edits, or rejects the draft. Review telemetry is written once; any domain change still uses the normal domain command.

Every run records capability, provider, model, prompt version, status, timestamps, confidence where meaningful, and whether a user accepted the result.

The execution state machine is `QUEUED -> RUNNING -> SUCCEEDED | FAILED`. `REJECTED` is retained for a successful draft subsequently rejected by staff. A recovered event whose run is already `RUNNING` fails with `AI_PROVIDER_OUTCOME_UNKNOWN` instead of calling the provider again, because the prior request may have reached the provider.

## Feature flags, budget, and review

- Every shop has a disabled-by-default setting for each capability.
- Budget accounting is scoped by `(shop, capability, UTC month)`. Enqueue reserves the configured upper-bound cost under a database lock; worker completion reconciles reserved and spent micro-USD.
- Same `Idempotency-Key` and payload return the same run without another reservation or outbox event. A changed payload returns `IDEMPOTENCY_KEY_REUSED`.
- OWNER manages flags and budgets with optimistic concurrency. Global disable overrides shop settings.
- `GET /api/v1/settings/ai` also returns current UTC-month reserved and spent micro-USD for each
  capability. `GET /api/v1/settings/ai/analytics` returns owner-only daily aggregates for at most
  90 days with a stable cursor; it never returns run/order/user IDs or AI content.
- `GET /api/v1/ai/runs/{id}` never returns the private input reference, prompt, provider body, token usage, or provider request identifier.
- `POST /api/v1/ai/runs/{id}/review` validates reviewed output against the capability schema, calculates edit distance, discards the submitted reviewed value, and never mutates a business entity.

## Common restrictions

Never send:

- Customer name, phone, email, or address unless a later reviewed capability strictly requires it.
- Device PIN, password, recovery key, authentication cookie, or public token.
- Staff access tokens or secrets.
- Unrelated photos or full internal history.
- Internal part cost when producing customer-facing text.

The gateway applies timeout, retry limit, per-shop budget, output-size limit, and circuit breaking. Provider failure returns a stable AI error code and leaves the manual workflow available.

DeepSeek is the first production adapter through its OpenAI-compatible Responses API. Application code depends only on `AiGateway`; provider SDK/types and response bodies stay inside the adapter. CI uses a deterministic fake and makes no external AI request.

## Capability: `DEVICE_OCR`

### Purpose

Extract candidate identity fields from an authorized photo of a device label or settings screen.

### Input reference

```json
{
  "mediaAssetId": "uuid",
  "allowedFields": ["brand", "model", "serialNumber", "imei"]
}
```

### Output schema

```json
{
  "brand": {"value": "Apple", "confidence": 0.97},
  "model": {"value": "iPhone 13", "confidence": 0.92},
  "serialNumber": {"value": "ABC123", "confidence": 0.88},
  "imei": {"value": "123456789012345", "confidence": 0.91},
  "warnings": []
}
```

Prompt version is `device-ocr-v1` and schema version is `1`. Non-requested or uncertain fields are returned as `null`; IMEI remains text, contains exactly 15 decimal digits and passes Luhn. The API verifies the tenant, role, media state and private-object metadata before enqueue. The worker repeats those checks, downloads the object with server credentials, strips image metadata and sends one bounded in-memory image to the gateway. The media ID, object key, signed URL, image bytes, provider body and credentials never enter the provider text input, log, outbox or stored output.

Staff capability availability is read through `GET /api/v1/ai/capabilities`, which returns effective flags only and does not expose owner-only budgets. Staff compare the image and current form value, select each accepted field explicitly and apply it only to local form state. Review telemetry is recorded once; device persistence still uses the existing human-submitted device API.

## Capability: `INTAKE_DRAFT`

### Purpose

Turn staff text or transcribed audio into a structured intake draft.

### Input

```json
{
  "transcript": "Khách báo máy bị tắt nguồn...",
  "deviceType": "PHONE",
  "language": "vi"
}
```

### Output schema

```json
{
  "reportedProblem": "Thiết bị tự tắt nguồn khi pin còn khoảng 30%.",
  "visibleCondition": "Màn hình trầy nhẹ ở góc phải.",
  "accessories": ["Ốp lưng"],
  "customerClaims": ["Chưa từng thay pin"],
  "uncertainties": ["Chưa xác nhận máy có vào nước hay không"]
}
```

The model must not turn customer claims into verified facts. Staff reviews every field before intake submission.

Prompt version is `intake-draft-v1` and schema version is `1`. `TEXT` and staff-pasted
`TRANSCRIPT` inputs are Unicode-normalized, bounded and redacted before the private input snapshot
is persisted. Credentials, tokens and prompt-injection text fail with `AI_INPUT_PROHIBITED`.
Phone numbers and email addresses are replaced before persistence and provider delivery.

`AUDIO` references a short-lived private `AI_INTAKE_AUDIO` media asset. The worker repeats tenant,
purpose, expiry, MIME, size, checksum and duration checks, transcribes through the provider-neutral
`TranscriptionGateway`, disposes the bytes, redacts the transcript and only then calls `AiGateway`.
Raw audio, transcription-provider bodies and the intermediate transcript are not stored in the run,
outbox or logs. The worker deletes the short-lived audio object and provisional media row after the
transcription attempt. RF-063 ships only a deterministic fake transcription adapter, so production audio
remains disabled until an audited speech provider and retention decision are added.

## Capability: `CHECKLIST_SUGGESTION`

### Purpose

Suggest diagnostic or QC checks based on device type, reported symptom, and shop-approved checklist catalogue.

### Input

```json
{
  "phase": "QC",
  "deviceType": "LAPTOP",
  "reportedProblem": "Không nhận sạc",
  "allowedChecklistItems": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "label": "Kiểm tra adapter",
      "isRequired": true,
      "allowNa": false
    },
    {
      "id": "22222222-2222-4222-8222-222222222222",
      "label": "Kiểm tra cổng sạc",
      "isRequired": true,
      "allowNa": false
    }
  ]
}
```

### Output schema

```json
{
  "suggestedItemIds": [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ],
  "reasoningSummary": "Triệu chứng liên quan đường cấp nguồn.",
  "safetyWarnings": ["Nhân viên vẫn phải thực hiện đầy đủ checklist của cửa hàng."]
}
```

The client sends only `repairOrderId`, `qcTemplateId`, and `phase`. The API verifies the active
tenant-owned order and template, enforces active technician assignment, and builds this redacted
snapshot. The current QC schema has no device-compatibility field, so active templates are treated
as globally compatible until a separately specified template taxonomy is introduced.

Prompt version is `checklist-suggestion-v1` and schema version is `1`. Output IDs must be unique and
a subset of the server-owned item allowlist. Unknown or duplicate IDs fail the whole run with
`AI_OUTPUT_INVALID`. Summary and warnings must be plain text and cannot assert a diagnosis, price,
deadline, guarantee, PASS, or FAIL. Apply records review telemetry and only highlights items in the
local QC form; it never creates a template, fills a result, submits QC, or changes repair state.

## Capability: `CUSTOMER_SUMMARY`

### Purpose

Rewrite selected technical notes into concise customer-safe Vietnamese.

### Input

```json
{
  "tone": "CLEAR_NEUTRAL",
  "maxCharacters": 400,
  "facts": [
    {
      "id": "diagnosis-finding",
      "kind": "DIAGNOSIS_FINDING",
      "text": "Pin bị phồng và máy tắt nguồn khi rút sạc."
    },
    {
      "id": "work-log-1",
      "kind": "WORK_LOG",
      "text": "Đã vệ sinh cổng sạc và kiểm tra nguồn."
    }
  ]
}
```

The API accepts only repair-order and source IDs. It verifies tenant ownership, current diagnosis,
effective technical work logs and active technician assignment, then creates this redacted fact
snapshot on the server. Prompt version `customer-summary-v1` rejects output that is not grounded in
the claimed fact IDs or contains customer identifiers, credentials, prices, commitments, warranty
promises, links or markup.

### Output schema

```json
{
  "summary": "Kỹ thuật viên ghi nhận pin đã xuống cấp và quá trình sạc nhanh không ổn định. Cửa hàng đề xuất thay pin để tiếp tục kiểm tra.",
  "claimsUsed": ["diagnosis-finding", "work-log-1"],
  "warnings": []
}
```

The summary cannot add price, completion promise, warranty promise, diagnosis, or certainty absent from approved facts.

## Acceptance telemetry

For each capability, measure:

- Runs requested and succeeded.
- Provider latency and estimated cost.
- Output accepted without edit, accepted after edit, or rejected.
- Character or field edit distance where appropriate.
- Staff-estimated time saved during the pilot.

Do not store raw secrets or prohibited PII in analytics.

Analytics are grouped by UTC day and capability. They contain counts, review outcomes, p50/p95
latency, token totals, estimated cost, and optional average edit-distance/time-saved values. They do
not contain run ID, repair-order ID, staff/customer identity, prompt, input snapshot, output,
provider body, destination, raw exception, token, or secret.
