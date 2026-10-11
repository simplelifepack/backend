ALTER TABLE "ReadinessPack" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Requirement" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "ReadinessPack_deletedAt_idx" ON "ReadinessPack"("deletedAt");
CREATE INDEX "Requirement_deletedAt_idx" ON "Requirement"("deletedAt");
