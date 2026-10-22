-- Apply only with all health writers/workers stopped; backfill then validate.
-- Native clinical columns become fixed sentinels or keyed equality indexes.
ALTER TABLE "health_members" ADD COLUMN "private_name" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_relation" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_bloodGroup" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_dateOfBirth" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_conditions" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_allergies" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_emergencyContactName" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_emergencyContactPhone" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_primaryDoctor" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_insuranceProvider" TEXT;
ALTER TABLE "health_members" ADD COLUMN "private_insurancePolicyNumber" TEXT;
ALTER TABLE "health_members" ADD CONSTRAINT "health_members_private_v2" CHECK (
  ("private_name" IS NOT NULL AND "private_name" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("name" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_relation" IS NOT NULL AND "private_relation" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("relation" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_bloodGroup" IS NOT NULL AND "private_bloodGroup" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("bloodGroup" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_dateOfBirth" IS NOT NULL AND "private_dateOfBirth" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dateOfBirth" IS NULL)
  AND ("private_conditions" IS NOT NULL AND "private_conditions" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("conditions" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_allergies" IS NOT NULL AND "private_allergies" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("allergies" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_emergencyContactName" IS NOT NULL AND "private_emergencyContactName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("emergencyContactName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_emergencyContactPhone" IS NOT NULL AND "private_emergencyContactPhone" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("emergencyContactPhone" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_primaryDoctor" IS NOT NULL AND "private_primaryDoctor" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("primaryDoctor" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_insuranceProvider" IS NOT NULL AND "private_insuranceProvider" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("insuranceProvider" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_insurancePolicyNumber" IS NOT NULL AND "private_insurancePolicyNumber" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("insurancePolicyNumber" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "health_documents" ADD COLUMN "private_type" TEXT;
ALTER TABLE "health_documents" ADD COLUMN "private_documentDate" TEXT;
ALTER TABLE "health_documents" ADD COLUMN "private_provider" TEXT;
ALTER TABLE "health_documents" ADD COLUMN "private_doctor" TEXT;
ALTER TABLE "health_documents" ADD COLUMN "private_processingError" TEXT;
ALTER TABLE "health_documents" ADD COLUMN "private_patientName" TEXT;
ALTER TABLE "health_documents" ADD COLUMN "private_patientDateOfBirth" TEXT;
ALTER TABLE "health_documents" ADD COLUMN "private_pendingExtraction" TEXT;
ALTER TABLE "health_documents" ADD CONSTRAINT "health_documents_private_v2" CHECK (
  ("private_type" IS NOT NULL AND "private_type" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("type" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_documentDate" IS NOT NULL AND "private_documentDate" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("documentDate" IS NULL)
  AND ("private_provider" IS NOT NULL AND "private_provider" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("provider" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_doctor" IS NOT NULL AND "private_doctor" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("doctor" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_processingError" IS NOT NULL AND "private_processingError" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("processingError" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_patientName" IS NOT NULL AND "private_patientName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("patientName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_patientDateOfBirth" IS NOT NULL AND "private_patientDateOfBirth" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("patientDateOfBirth" IS NULL)
  AND ("private_pendingExtraction" IS NOT NULL AND "private_pendingExtraction" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("pendingExtraction" IS NULL)
) NOT VALID;
ALTER TABLE "health_measurements" ADD COLUMN "private_metricKey" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_displayName" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_originalName" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_value" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_secondaryValue" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_unit" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_context" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_bodySite" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_referenceMin" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_referenceMax" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_referenceText" TEXT;
ALTER TABLE "health_measurements" ADD COLUMN "private_measuredAt" TEXT;
ALTER TABLE "health_measurements" ADD CONSTRAINT "health_measurements_private_v2" CHECK (
  ("private_metricKey" IS NOT NULL AND "private_metricKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("metricKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_displayName" IS NOT NULL AND "private_displayName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("displayName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_originalName" IS NOT NULL AND "private_originalName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("originalName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_value" IS NOT NULL AND "private_value" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("value" = 0)
  AND ("private_secondaryValue" IS NOT NULL AND "private_secondaryValue" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("secondaryValue" IS NULL)
  AND ("private_unit" IS NOT NULL AND "private_unit" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("unit" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_context" IS NOT NULL AND "private_context" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("context" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_bodySite" IS NOT NULL AND "private_bodySite" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("bodySite" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_referenceMin" IS NOT NULL AND "private_referenceMin" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("referenceMin" IS NULL)
  AND ("private_referenceMax" IS NOT NULL AND "private_referenceMax" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("referenceMax" IS NULL)
  AND ("private_referenceText" IS NOT NULL AND "private_referenceText" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("referenceText" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_measuredAt" IS NOT NULL AND "private_measuredAt" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("measuredAt" = TIMESTAMP '1970-01-01 00:00:00')
) NOT VALID;
ALTER TABLE "tracked_health_metrics" ADD COLUMN "private_metricKey" TEXT;
ALTER TABLE "tracked_health_metrics" ADD COLUMN "private_displayName" TEXT;
ALTER TABLE "tracked_health_metrics" ADD COLUMN "private_context" TEXT;
ALTER TABLE "tracked_health_metrics" ADD COLUMN "private_bodySite" TEXT;
ALTER TABLE "tracked_health_metrics" ADD COLUMN "private_enabled" TEXT;
ALTER TABLE "tracked_health_metrics" ADD CONSTRAINT "tracked_health_metrics_private_v2" CHECK (
  ("private_metricKey" IS NOT NULL AND "private_metricKey" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("metricKey" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_displayName" IS NOT NULL AND "private_displayName" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("displayName" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_context" IS NOT NULL AND "private_context" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("context" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_bodySite" IS NOT NULL AND "private_bodySite" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("bodySite" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_enabled" IS NOT NULL AND "private_enabled" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("enabled" = false)
) NOT VALID;
ALTER TABLE "health_medications" ADD COLUMN "private_name" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_dose" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_frequency" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_duration" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_quantity" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_whenToTake" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_mealTiming" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_repeatRunsOut" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_status" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_repeats" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_runsOutAt" TEXT;
ALTER TABLE "health_medications" ADD COLUMN "private_stoppedAt" TEXT;
ALTER TABLE "health_medications" ADD CONSTRAINT "health_medications_private_v2" CHECK (
  ("private_name" IS NOT NULL AND "private_name" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("name" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_dose" IS NOT NULL AND "private_dose" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dose" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_frequency" IS NOT NULL AND "private_frequency" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("frequency" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_duration" IS NOT NULL AND "private_duration" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("duration" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_quantity" IS NOT NULL AND "private_quantity" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("quantity" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_whenToTake" IS NOT NULL AND "private_whenToTake" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND (cardinality("whenToTake") = 0)
  AND ("private_mealTiming" IS NOT NULL AND "private_mealTiming" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("mealTiming" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_repeatRunsOut" IS NOT NULL AND "private_repeatRunsOut" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("repeatRunsOut" IS NULL)
  AND ("private_status" IS NOT NULL AND "private_status" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("status" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_repeats" IS NOT NULL AND "private_repeats" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("repeats" = false)
  AND ("private_runsOutAt" IS NOT NULL AND "private_runsOutAt" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("runsOutAt" IS NULL)
  AND ("private_stoppedAt" IS NOT NULL AND "private_stoppedAt" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("stoppedAt" IS NULL)
) NOT VALID;
ALTER TABLE "health_follow_ups" ADD COLUMN "private_title" TEXT;
ALTER TABLE "health_follow_ups" ADD COLUMN "private_explicitDate" TEXT;
ALTER TABLE "health_follow_ups" ADD COLUMN "private_recommendedAfterValue" TEXT;
ALTER TABLE "health_follow_ups" ADD COLUMN "private_recommendedAfterUnit" TEXT;
ALTER TABLE "health_follow_ups" ADD COLUMN "private_dueDate" TEXT;
ALTER TABLE "health_follow_ups" ADD COLUMN "private_sourceText" TEXT;
ALTER TABLE "health_follow_ups" ADD CONSTRAINT "health_follow_ups_private_v2" CHECK (
  ("private_title" IS NOT NULL AND "private_title" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("title" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_explicitDate" IS NOT NULL AND "private_explicitDate" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("explicitDate" IS NULL)
  AND ("private_recommendedAfterValue" IS NOT NULL AND "private_recommendedAfterValue" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("recommendedAfterValue" IS NULL)
  AND ("private_recommendedAfterUnit" IS NOT NULL AND "private_recommendedAfterUnit" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("recommendedAfterUnit" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_dueDate" IS NOT NULL AND "private_dueDate" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dueDate" IS NULL)
  AND ("private_sourceText" IS NOT NULL AND "private_sourceText" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("sourceText" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
ALTER TABLE "health_reminders" ADD COLUMN "private_title" TEXT;
ALTER TABLE "health_reminders" ADD COLUMN "private_type" TEXT;
ALTER TABLE "health_reminders" ADD COLUMN "private_dueDate" TEXT;
ALTER TABLE "health_reminders" ADD COLUMN "private_frequency" TEXT;
ALTER TABLE "health_reminders" ADD COLUMN "private_recurrence" TEXT;
ALTER TABLE "health_reminders" ADD COLUMN "private_status" TEXT;
ALTER TABLE "health_reminders" ADD CONSTRAINT "health_reminders_private_v2" CHECK (
  ("private_title" IS NOT NULL AND "private_title" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("title" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_type" IS NOT NULL AND "private_type" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("type" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_dueDate" IS NOT NULL AND "private_dueDate" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("dueDate" = TIMESTAMP '1970-01-01 00:00:00')
  AND ("private_frequency" IS NOT NULL AND "private_frequency" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("frequency" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_recurrence" IS NOT NULL AND "private_recurrence" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("recurrence" ~ '^hmac:v2:[0-9a-f]{64}$')
  AND ("private_status" IS NOT NULL AND "private_status" ~ '^enc:v2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$')
  AND ("status" ~ '^hmac:v2:[0-9a-f]{64}$')
) NOT VALID;
