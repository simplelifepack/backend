-- RenameIndex
DO $$
BEGIN
  IF to_regclass('"Document_classificationStatus_ownershipStatus_integrityStatus_i"') IS NOT NULL
    AND to_regclass('"Document_classificationStatus_ownershipStatus_integrityStat_idx"') IS NULL THEN
    ALTER INDEX "Document_classificationStatus_ownershipStatus_integrityStatus_i"
      RENAME TO "Document_classificationStatus_ownershipStatus_integrityStat_idx";
  END IF;
END $$;
