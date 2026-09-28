CREATE TABLE IF NOT EXISTS "requirement_assignments" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requirementId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "assignmentSource" TEXT NOT NULL,
  "overriddenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "requirement_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "requirement_assignments_userId_requirementId_key" ON "requirement_assignments"("userId", "requirementId");
CREATE INDEX IF NOT EXISTS "requirement_assignments_documentId_idx" ON "requirement_assignments"("documentId");
CREATE INDEX IF NOT EXISTS "requirement_assignments_requirementId_idx" ON "requirement_assignments"("requirementId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requirement_assignments_userId_fkey') THEN
    ALTER TABLE "requirement_assignments"
      ADD CONSTRAINT "requirement_assignments_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requirement_assignments_requirementId_fkey') THEN
    ALTER TABLE "requirement_assignments"
      ADD CONSTRAINT "requirement_assignments_requirementId_fkey"
      FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'requirement_assignments_documentId_fkey') THEN
    ALTER TABLE "requirement_assignments"
      ADD CONSTRAINT "requirement_assignments_documentId_fkey"
      FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
