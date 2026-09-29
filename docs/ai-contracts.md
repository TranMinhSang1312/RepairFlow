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

All fields are nullable. IMEI must remain text and pass syntax validation. Staff must compare the image and confirm each accepted field.

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

## Capability: `CHECKLIST_SUGGESTION`

### Purpose

Suggest diagnostic or QC checks based on device type, reported symptom, and shop-approved checklist catalogue.

### Input

```json
{
  "deviceType": "LAPTOP",
  "reportedProblem": "Không nhận sạc",
  "allowedChecklistItems": [
    {"id": "power-adapter", "label": "Kiểm tra adapter"},
    {"id": "charge-port", "label": "Kiểm tra cổng sạc"}
  ]
}
```

### Output schema

```json
{
  "suggestedItemIds": ["power-adapter", "charge-port"],
  "reasoningSummary": "Triệu chứng liên quan đường cấp nguồn.",
  "safetyWarnings": []
}
```

The output may only select from supplied catalogue IDs. It cannot create a binding diagnosis or mark a check as passed.

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
