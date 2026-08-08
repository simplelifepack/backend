CREATE TABLE "lifepack_form_categories" (
  "id" TEXT NOT NULL,
  "module" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "wealthRecordType" "WealthRecordType",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lifepack_form_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lifepack_form_subtypes" (
  "id" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lifepack_form_subtypes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lifepack_form_fields" (
  "id" TEXT NOT NULL,
  "subtypeId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "inputType" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "placeholder" TEXT,
  "defaultValue" JSONB,
  "options" JSONB,
  "validation" JSONB,
  "group" TEXT,
  "visibility" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lifepack_form_fields_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lifepack_form_categories_module_code_key" ON "lifepack_form_categories"("module", "code");
CREATE INDEX "lifepack_form_categories_module_isActive_sortOrder_idx" ON "lifepack_form_categories"("module", "isActive", "sortOrder");
CREATE UNIQUE INDEX "lifepack_form_subtypes_categoryId_code_key" ON "lifepack_form_subtypes"("categoryId", "code");
CREATE INDEX "lifepack_form_subtypes_categoryId_isActive_sortOrder_idx" ON "lifepack_form_subtypes"("categoryId", "isActive", "sortOrder");
CREATE UNIQUE INDEX "lifepack_form_fields_subtypeId_fieldId_key" ON "lifepack_form_fields"("subtypeId", "fieldId");
CREATE INDEX "lifepack_form_fields_subtypeId_isActive_sortOrder_idx" ON "lifepack_form_fields"("subtypeId", "isActive", "sortOrder");

ALTER TABLE "lifepack_form_subtypes"
  ADD CONSTRAINT "lifepack_form_subtypes_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "lifepack_form_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lifepack_form_fields"
  ADD CONSTRAINT "lifepack_form_fields_subtypeId_fkey"
  FOREIGN KEY ("subtypeId") REFERENCES "lifepack_form_subtypes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
