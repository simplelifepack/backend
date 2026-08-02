UPDATE "Requirement"
SET "documentType" = 'pan', "acceptedDocumentTypes" = ARRAY['pan']::TEXT[]
WHERE "documentType" IN ('government_id', 'government_id_address', 'identity_document')
  AND ("title" ILIKE '%PAN Card%' OR "title" ILIKE '%Permanent Account Number%');

UPDATE "Requirement"
SET "documentType" = 'aadhaar', "acceptedDocumentTypes" = ARRAY['aadhaar']::TEXT[]
WHERE "documentType" IN ('government_id', 'government_id_address', 'identity_document')
  AND ("title" ILIKE '%Aadhaar%' OR "title" ILIKE '%UIDAI%');

UPDATE "Requirement"
SET "documentType" = 'bank_statement', "acceptedDocumentTypes" = ARRAY['bank_statement', 'cancelled_cheque']::TEXT[]
WHERE "documentType" = 'bank_proof' AND "title" ILIKE '%bank statement%';
