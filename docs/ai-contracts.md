# RepairFlow AI Contracts

Status: proposed specification for `spec-v0.1`

## Purpose

AI capabilities reduce repetitive entry and rewriting. They do not diagnose a device, price work, approve a quote, change workflow state, decide warranty, or write directly to domain tables.

## Execution contract

1. An authorized staff request creates an `ai_runs` row with `QUEUED` status.
2. The API creates an outbox/job record and returns `202` with the run ID.
3. A worker loads only the authorized input required for the capability.
4. The worker redacts prohibited personal or secret data.
5. The AI Gateway calls a provider adapter with a versioned prompt and JSON schema.
6. Output is parsed and validated. Invalid output is failed, never partially applied.
7. A successful output is stored in `ai_runs.output` and displayed as an `AI draft`.
8. A staff member explicitly accepts or edits the draft through a normal domain command.

Every run records capability, provider, model, prompt version, status, timestamps, confidence where meaningful, and whether a user accepted the result.

## Common restrictions

Never send:

- Customer name, phone, email, or address unless a later reviewed capability strictly requires it.
- Device PIN, password, recovery key, authentication cookie, or public token.
- Staff access tokens or secrets.
- Unrelated photos or full internal history.
- Internal part cost when producing customer-facing text.

The gateway applies timeout, retry limit, per-shop budget, output-size limit, and circuit breaking. Provider failure returns a stable AI error code and leaves the manual workflow available.

## Capability: `DEVICE_OCR`

### Purpose

Extract candidate identity fields from an authorized photo of a device label or settings screen.

### Input reference

```json
{
  "mediaAssetId": "uuid",
  "allowedFields": ["brand", "model", "serial", "imei"]
}
```

### Output schema

```json
{
  "brand": {"value": "Apple", "confidence": 0.97},
  "model": {"value": "iPhone 13", "confidence": 0.92},
  "serial": {"value": "ABC123", "confidence": 0.88},
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
  "technicalNotes": ["Đo pin còn 71% SOH", "Test sạc nhanh không ổn định"],
  "approvedFacts": ["Pin đã chai", "Khuyến nghị thay pin"],
  "tone": "clear-neutral",
  "maxCharacters": 500
}
```

### Output schema

```json
{
  "summary": "Kỹ thuật viên ghi nhận pin đã xuống cấp và quá trình sạc nhanh không ổn định. Cửa hàng đề xuất thay pin để tiếp tục kiểm tra.",
  "claimsUsed": ["Pin đã chai", "Khuyến nghị thay pin"],
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

