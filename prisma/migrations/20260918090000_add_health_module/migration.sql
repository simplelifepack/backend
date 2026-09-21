CREATE TABLE "health_members" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "relation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "health_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "health_documents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "documentDate" TIMESTAMP(3),
  "provider" TEXT,
  "doctor" TEXT,
  "processingStatus" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "health_documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "health_measurements" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "secondaryValue" DOUBLE PRECISION,
  "unit" TEXT NOT NULL,
  "context" TEXT,
  "bodySite" TEXT,
  "referenceMin" DOUBLE PRECISION,
  "referenceMax" DOUBLE PRECISION,
  "referenceText" TEXT,
  "measuredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_measurements_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracked_health_metrics" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "context" TEXT,
  "bodySite" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tracked_health_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "health_medications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dose" TEXT,
  "frequency" TEXT,
  "duration" TEXT,
  "quantity" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_medications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "health_follow_ups" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "sourceDocumentId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "explicitDate" TIMESTAMP(3),
  "recommendedAfterValue" INTEGER,
  "recommendedAfterUnit" TEXT,
  "dueDate" TIMESTAMP(3),
  "sourceText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "health_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "health_reminders" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "sourceFollowUpId" TEXT,
  "sourceDocumentId" TEXT,
  "title" TEXT NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "origin" TEXT NOT NULL,
  "recurrence" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "health_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_documents_userId_documentId_key" ON "health_documents"("userId", "documentId");
CREATE INDEX "health_members_userId_idx" ON "health_members"("userId");
CREATE INDEX "health_documents_userId_memberId_documentDate_idx" ON "health_documents"("userId", "memberId", "documentDate");
CREATE INDEX "health_documents_documentId_idx" ON "health_documents"("documentId");
CREATE INDEX "health_measurements_userId_memberId_metricKey_measuredAt_idx" ON "health_measurements"("userId", "memberId", "metricKey", "measuredAt");
CREATE INDEX "health_measurements_sourceDocumentId_idx" ON "health_measurements"("sourceDocumentId");
CREATE UNIQUE INDEX "tracked_health_metrics_userId_memberId_metricKey_context_bodySite_key" ON "tracked_health_metrics"("userId", "memberId", "metricKey", "context", "bodySite");
CREATE INDEX "tracked_health_metrics_userId_memberId_enabled_idx" ON "tracked_health_metrics"("userId", "memberId", "enabled");
CREATE INDEX "health_medications_userId_memberId_idx" ON "health_medications"("userId", "memberId");
CREATE INDEX "health_medications_sourceDocumentId_idx" ON "health_medications"("sourceDocumentId");
CREATE INDEX "health_follow_ups_userId_memberId_dueDate_idx" ON "health_follow_ups"("userId", "memberId", "dueDate");
CREATE INDEX "health_follow_ups_sourceDocumentId_idx" ON "health_follow_ups"("sourceDocumentId");
CREATE INDEX "health_reminders_userId_memberId_dueDate_status_idx" ON "health_reminders"("userId", "memberId", "dueDate", "status");
CREATE INDEX "health_reminders_sourceDocumentId_idx" ON "health_reminders"("sourceDocumentId");

ALTER TABLE "health_members" ADD CONSTRAINT "health_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "health_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "health_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "health_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracked_health_metrics" ADD CONSTRAINT "tracked_health_metrics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracked_health_metrics" ADD CONSTRAINT "tracked_health_metrics_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "health_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_medications" ADD CONSTRAINT "health_medications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_medications" ADD CONSTRAINT "health_medications_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "health_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_medications" ADD CONSTRAINT "health_medications_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "health_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_follow_ups" ADD CONSTRAINT "health_follow_ups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_follow_ups" ADD CONSTRAINT "health_follow_ups_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "health_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_follow_ups" ADD CONSTRAINT "health_follow_ups_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "health_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_reminders" ADD CONSTRAINT "health_reminders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_reminders" ADD CONSTRAINT "health_reminders_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "health_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_reminders" ADD CONSTRAINT "health_reminders_sourceFollowUpId_fkey" FOREIGN KEY ("sourceFollowUpId") REFERENCES "health_follow_ups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "health_reminders" ADD CONSTRAINT "health_reminders_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "health_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
