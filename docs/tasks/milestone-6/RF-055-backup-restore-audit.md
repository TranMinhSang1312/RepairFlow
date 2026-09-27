# RF-055 — Backup, restore drill, and Milestone 6 final audit

## Mục tiêu

Chứng minh dữ liệu nghiệp vụ PostgreSQL và bằng chứng media trong object storage có thể được sao lưu, kiểm tra toàn vẹn và phục hồi vào môi trường cô lập. Hoàn tất Milestone 6 bằng bằng chứng kiểm tra worker, notification delivery, owner operations và observability.

## Kết quả vận hành

- Có backup bundle gồm PostgreSQL custom dump, object archive và manifest checksum an toàn.
- Restore drill không bao giờ ghi vào database hoặc bucket chính; target tạm được tạo với prefix cố định và xóa sau kiểm tra.
- Manifest/evidence chỉ chứa checksum và số liệu tổng hợp. Không chứa destination, object key, payload, raw token, credential hoặc dữ liệu khách hàng.
- Production runbook quy định lịch backup, retention, mã hóa, quyền truy cập, restore order và release evidence.
- Milestone 6 exit criteria có test/evidence cụ thể và không còn blocker đã biết.

## Phạm vi backup

1. PostgreSQL: schema, migrations, business records, audit/timeline, idempotency, outbox và notification delivery.
2. Private object storage: media/evidence hiện hành. Production phải bật versioning hoặc provider snapshot; local bundle lưu current object state.
3. Git revision và deployment configuration được quản lý ngoài bundle. Secret không được đưa vào backup bundle; secret manager có quy trình phục hồi riêng.

## Contract công cụ local

```text
pnpm ops:backup -- --output-dir <ignored-directory>
pnpm ops:restore-drill -- --bundle <bundle-directory> --evidence <ignored-json-path>
```

- Công cụ dùng các service `postgres` và `minio` của Docker Compose theo mặc định.
- Có thể đổi tên service/source qua biến `REPAIRFLOW_*`; tên phải qua allowlist identifier.
- Backup từ chối ghi đè bundle đã có manifest và xóa file `.partial` khi lỗi.
- Backup so sánh fingerprint trước/sau để phát hiện thay đổi row-count hoặc object inventory trong cửa sổ tạo bundle.
- Restore kiểm tra byte length và SHA-256 trước khi tạo target.
- Database target bắt buộc có prefix `repairflow_restore_drill_`; bucket target bắt buộc có prefix `repairflow-restore-drill-`. Target chính luôn bị từ chối.
- Drill so sánh fingerprint toàn bộ public-table row counts và object key/size inventory, sau đó dọn target trong `finally`.

## Quy trình production

- Pilot target: backup hằng ngày, RPO tối đa 24 giờ và RTO mục tiêu 4 giờ; đánh giá lại trước khi tăng quy mô.
- PostgreSQL ưu tiên managed snapshot/PITR; object storage bật versioning và replication/snapshot độc lập.
- Backup được mã hóa, đặt ngoài cùng failure domain, giới hạn quyền và giữ tối thiểu 7 bản daily cùng 4 bản weekly.
- Restore production luôn tạo môi trường cô lập trước. Chỉ chuyển traffic sau checksum, migration status, record/media verification và smoke test.
- Không chạy local drill scripts để overwrite production.

## Ngoài phạm vi

- Tự động upload backup lên cloud, chọn vendor hoặc quản lý KMS/secret manager.
- Point-in-time recovery engine, multi-region failover hoặc hot standby.
- Restore trực tiếp đè database/bucket đang phục vụ traffic.
- Thay đổi business schema, API, notification provider hoặc UI.

## File ownership

- `scripts/backup-restore-lib.mjs`
- `scripts/backup-local.mjs`
- `scripts/restore-drill-local.mjs`
- `scripts/backup-restore.test.mjs`
- `package.json`
- `docs/operations/backup-restore.md`
- `docs/operations/restore-drills/2026-09-27-rf055.md`
- `docs/operations/milestone-6-final-audit.md`
- `docs/tasks/milestone-6/RF-055-backup-restore-audit.md`

## Acceptance criteria

- Backup bundle tạo thành công từ infrastructure local đang healthy; checksum được ghi và không có file partial.
- Restore drill dùng target cô lập, khớp database/object fingerprint và không để lại target tạm.
- Guard tests chứng minh primary target, identifier injection, unknown/incomplete argument bị từ chối.
- Runbook mô tả owner, schedule, RPO/RTO, retention, encryption, restore, cleanup và incident verification.
- Migration deployment/status, seed, format, lint, typecheck, full tests và build đạt.
- Audit chứng minh claim isolation, retry/dead-letter, provider idempotency, tenant/token safety, owner retry và telemetry boundary.
- Git chỉ chứa script, tài liệu và evidence tổng hợp; backup artifacts ở `.local/` không được track.

## Definition of Done

- Restore drill PASS được ghi ngày, revision, tool versions, aggregate counts, checksum verification và cleanup result.
- Milestone 6 exit criteria đều có liên kết tới implementation/test/evidence.
- Mọi kiểm tra bắt buộc đạt; limitation production-provider drill được ghi rõ.
- Chưa commit hoặc push trong lượt triển khai này.

## AI implementation prompt

Đọc `AGENTS.md`, `docs/tasks/milestone-6/README.md`, file RF này, architecture, implementation plan và testing strategy. Triển khai backup bundle và restore drill an toàn cho PostgreSQL + private object storage theo contract; không ghi secret, object key, payload, destination hoặc raw token vào manifest/evidence/log. Restore chỉ được dùng target tạm có prefix allowlist, từ chối primary và luôn cleanup. Chạy một drill thật trên Docker Compose, ghi evidence tổng hợp, audit toàn bộ Milestone 6, chạy infrastructure, migration deployment/status, seed, format, lint, typecheck, full tests và build. Không commit hoặc push.
