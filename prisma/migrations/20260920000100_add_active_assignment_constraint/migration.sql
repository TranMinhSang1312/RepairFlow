-- Preserve assignment history while guaranteeing one current technician per order.
CREATE UNIQUE INDEX "assignments_one_active_per_order_idx"
ON "assignments" ("shopId", "repairOrderId")
WHERE "unassignedAt" IS NULL;
