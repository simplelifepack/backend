-- Keep the small encrypted receipt for retries until its document is deleted.
ALTER TABLE "TemporaryUpload" ADD CONSTRAINT "TemporaryUpload_savedDocumentId_fkey"
  FOREIGN KEY ("savedDocumentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "TemporaryUpload_savedDocumentId_idx" ON "TemporaryUpload"("savedDocumentId");
-- Plain clinical JSON must never reach this column through alternate clients.
ALTER TABLE "TemporaryUpload" ADD CONSTRAINT "TemporaryUpload_analysis_ciphertext_only"
  CHECK ("analysis" IS NULL AND ("private_analysis" IS NULL OR "private_analysis" LIKE 'enc:v2:%'));
