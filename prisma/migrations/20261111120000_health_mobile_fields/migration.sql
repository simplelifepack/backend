ALTER TABLE "health_members" ADD COLUMN "emergencyContactRelationship" TEXT, ADD COLUMN "private_emergencyContactRelationship" TEXT,
  ADD CONSTRAINT "health_members_emergencyContactRelationship_private" CHECK (("emergencyContactRelationship" IS NULL OR ("emergencyContactRelationship" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_emergencyContactRelationship" IS NOT NULL)) AND ("private_emergencyContactRelationship" IS NULL OR "private_emergencyContactRelationship" ~ '^enc:v2:'));

ALTER TABLE "health_measurements" ADD COLUMN "timeZone" TEXT, ADD COLUMN "private_timeZone" TEXT,
  ADD CONSTRAINT "health_measurements_timeZone_private" CHECK (("timeZone" IS NULL OR ("timeZone" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_timeZone" IS NOT NULL)) AND ("private_timeZone" IS NULL OR "private_timeZone" ~ '^enc:v2:'));

ALTER TABLE "health_measurements" ADD COLUMN "source" TEXT, ADD COLUMN "private_source" TEXT,
  ADD CONSTRAINT "health_measurements_source_private" CHECK (("source" IS NULL OR ("source" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_source" IS NOT NULL)) AND ("private_source" IS NULL OR "private_source" ~ '^enc:v2:'));

ALTER TABLE "health_measurements" ADD COLUMN "notes" TEXT, ADD COLUMN "private_notes" TEXT,
  ADD CONSTRAINT "health_measurements_notes_private" CHECK (("notes" IS NULL OR ("notes" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_notes" IS NOT NULL)) AND ("private_notes" IS NULL OR "private_notes" ~ '^enc:v2:'));

ALTER TABLE "health_medications" ADD COLUMN "route" TEXT, ADD COLUMN "private_route" TEXT,
  ADD CONSTRAINT "health_medications_route_private" CHECK (("route" IS NULL OR ("route" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_route" IS NOT NULL)) AND ("private_route" IS NULL OR "private_route" ~ '^enc:v2:'));

ALTER TABLE "health_medications" ADD COLUMN "instructions" TEXT, ADD COLUMN "private_instructions" TEXT,
  ADD CONSTRAINT "health_medications_instructions_private" CHECK (("instructions" IS NULL OR ("instructions" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_instructions" IS NOT NULL)) AND ("private_instructions" IS NULL OR "private_instructions" ~ '^enc:v2:'));

ALTER TABLE "health_medications" ADD COLUMN "courseStartDate" TIMESTAMP(3), ADD COLUMN "private_courseStartDate" TEXT,
  ADD CONSTRAINT "health_medications_courseStartDate_private" CHECK (("courseStartDate" IS NULL) AND ("private_courseStartDate" IS NULL OR "private_courseStartDate" ~ '^enc:v2:'));

ALTER TABLE "health_medications" ADD COLUMN "courseEndDate" TIMESTAMP(3), ADD COLUMN "private_courseEndDate" TEXT,
  ADD CONSTRAINT "health_medications_courseEndDate_private" CHECK (("courseEndDate" IS NULL) AND ("private_courseEndDate" IS NULL OR "private_courseEndDate" ~ '^enc:v2:'));

ALTER TABLE "health_medications" ADD COLUMN "prescribingDoctor" TEXT, ADD COLUMN "private_prescribingDoctor" TEXT,
  ADD CONSTRAINT "health_medications_prescribingDoctor_private" CHECK (("prescribingDoctor" IS NULL OR ("prescribingDoctor" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_prescribingDoctor" IS NOT NULL)) AND ("private_prescribingDoctor" IS NULL OR "private_prescribingDoctor" ~ '^enc:v2:'));

ALTER TABLE "health_reminders" ADD COLUMN "timeZone" TEXT, ADD COLUMN "private_timeZone" TEXT,
  ADD CONSTRAINT "health_reminders_timeZone_private" CHECK (("timeZone" IS NULL OR ("timeZone" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_timeZone" IS NOT NULL)) AND ("private_timeZone" IS NULL OR "private_timeZone" ~ '^enc:v2:'));

ALTER TABLE "health_reminders" ADD COLUMN "endDate" TIMESTAMP(3), ADD COLUMN "private_endDate" TEXT,
  ADD CONSTRAINT "health_reminders_endDate_private" CHECK (("endDate" IS NULL) AND ("private_endDate" IS NULL OR "private_endDate" ~ '^enc:v2:'));

ALTER TABLE "health_reminders" ADD COLUMN "notes" TEXT, ADD COLUMN "private_notes" TEXT,
  ADD CONSTRAINT "health_reminders_notes_private" CHECK (("notes" IS NULL OR ("notes" ~ '^hmac:v2:[0-9a-f]{64}$' AND "private_notes" IS NOT NULL)) AND ("private_notes" IS NULL OR "private_notes" ~ '^enc:v2:'));

ALTER TABLE "health_reminders"
  ADD COLUMN "medicationId" TEXT REFERENCES "health_medications"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD COLUMN "trackedMetricId" TEXT REFERENCES "tracked_health_metrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "health_visit_packets" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "memberId" TEXT NOT NULL REFERENCES "health_members"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recordIds" TEXT[] NOT NULL CHECK (cardinality("recordIds") = 0),
  "private_recordIds" TEXT NOT NULL CHECK ("private_recordIds" ~ '^enc:v2:'),
  "doctor" TEXT CHECK ("doctor" IS NULL OR "doctor" ~ '^hmac:v2:[0-9a-f]{64}$'),
  "private_doctor" TEXT NOT NULL CHECK ("private_doctor" ~ '^enc:v2:'),
  "clinic" TEXT CHECK ("clinic" IS NULL OR "clinic" ~ '^hmac:v2:[0-9a-f]{64}$'),
  "private_clinic" TEXT NOT NULL CHECK ("private_clinic" ~ '^enc:v2:'),
  "visitDate" TIMESTAMP(3) CHECK ("visitDate" IS NULL),
  "private_visitDate" TEXT NOT NULL CHECK ("private_visitDate" ~ '^enc:v2:'),
  "fileDocumentId" TEXT NOT NULL CHECK ("fileDocumentId" ~ '^hmac:v2:[0-9a-f]{64}$'),
  "private_fileDocumentId" TEXT NOT NULL CHECK ("private_fileDocumentId" ~ '^enc:v2:'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "health_visit_packets_userId_memberId_idx" ON "health_visit_packets" ("userId", "memberId");
ALTER TABLE "health_visit_packets" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "health_visit_packets" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "health_visit_packets" FROM authenticated;
  END IF;
END $$;
