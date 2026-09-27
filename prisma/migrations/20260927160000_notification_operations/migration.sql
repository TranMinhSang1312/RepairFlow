ALTER TABLE "outbox_events"
ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "outbox_events"
ADD CONSTRAINT "outbox_events_lock_version_check" CHECK ("lockVersion" >= 0);

CREATE INDEX "outbox_events_shopId_status_createdAt_id_idx"
ON "outbox_events"("shopId", "status", "createdAt" DESC, "id" DESC);
