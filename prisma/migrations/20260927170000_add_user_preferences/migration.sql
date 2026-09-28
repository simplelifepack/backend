ALTER TABLE "User"
  ADD COLUMN "country" TEXT,
  ADD COLUMN "passportCountry" TEXT,
  ADD COLUMN "homeCurrency" TEXT,
  ADD COLUMN "appearance" TEXT NOT NULL DEFAULT 'dark';
