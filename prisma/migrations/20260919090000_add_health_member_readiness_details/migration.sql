ALTER TABLE "health_members"
  ADD COLUMN "conditions" TEXT,
  ADD COLUMN "allergies" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "primaryDoctor" TEXT,
  ADD COLUMN "insuranceProvider" TEXT,
  ADD COLUMN "insurancePolicyNumber" TEXT;
