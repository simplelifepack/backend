# Files changed in this backend branch

This includes the existing encryption work and the follow-up local migration/extraction cleanup. No frontend or mobile files were edited in this follow-up. All changes remain in the current working tree.

| File | Change | Purpose |
|---|---|---|
| `.env.example` | Modified | Configure encryption/tooling; remove extraction packages/workers; add PDF structure support and verification commands. |
| `docs/account-usage-implementation.md` | Modified | Update extraction/integration behavior and operational documentation or redacted responses. |
| `docs/privacy/README.md` | Added | Encryption coverage, rollout, validation or file-change documentation. |
| `docs/privacy/changed-files.md` | Added | Full branch file-change inventory. |
| `docs/privacy/field-inventory.md` | Added | Encryption coverage, rollout, validation or file-change documentation. |
| `docs/privacy/local-validation.md` | Added | Encryption coverage, rollout, validation or file-change documentation. |
| `docs/privacy/persistence-paths.md` | Added | Encryption coverage, rollout, validation or file-change documentation. |
| `docs/privacy/validate-constraints.sql` | Added | Encryption coverage, rollout, validation or file-change documentation. |
| `package-lock.json` | Modified | Configure encryption/tooling; remove extraction packages/workers; add PDF structure support and verification commands. |
| `package.json` | Modified | Configure encryption/tooling; remove extraction packages/workers; add PDF structure support and verification commands. |
| `prisma/migrations/20261015190000_private_jobs_and_exports/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015200000_private_health_fields/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015210000_private_wealth_integration_fields/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015220000_private_document_fields/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015223000_private_cleanup_locators/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015230000_private_auth_profile_fields/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015233000_private_family_fields/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015234500_private_catalogue_fields/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/migrations/20261015235000_quarantine_legacy_catalogue_metadata/migration.sql` | Added | Add ciphertext columns, plaintext guards, ownership constraints or legacy catalogue quarantine. |
| `prisma/schema.prisma` | Modified | Declare encrypted companion columns and ownership/uniqueness relationships. |
| `readme.md` | Modified | Update extraction/integration behavior and operational documentation or redacted responses. |
| `src/ai/packageSourcePage.ts` | Modified | Protect AI/job content, diagnostics and original-PDF evidence processing without standalone PDF text extraction. |
| `src/ai/providers/openai.ts` | Modified | Protect AI/job content, diagnostics and original-PDF evidence processing without standalone PDF text extraction. |
| `src/ai/researchPackageRefresh.ts` | Modified | Protect AI/job content, diagnostics and original-PDF evidence processing without standalone PDF text extraction. |
| `src/app.ts` | Modified | Comment out future Gmail/Drive route mounts and published operations. |
| `src/docs/openapi.check.ts` | Modified | Comment out future Gmail/Drive route mounts and published operations. |
| `src/docs/openapi.ts` | Modified | Comment out future Gmail/Drive route mounts and published operations. |
| `src/index.ts` | Modified | Update extraction/integration behavior and operational documentation or redacted responses. |
| `src/lib/prisma.ts` | Modified | Enforce authenticated scoped decryption, protected persistence, minimal sessions and safe diagnostics/caching. |
| `src/middleware/errorHandling.ts` | Modified | Enforce authenticated scoped decryption, protected persistence, minimal sessions and safe diagnostics/caching. |
| `src/middleware/requireAuth.ts` | Modified | Enforce authenticated scoped decryption, protected persistence, minimal sessions and safe diagnostics/caching. |
| `src/middleware/security.ts` | Modified | Enforce authenticated scoped decryption, protected persistence, minimal sessions and safe diagnostics/caching. |
| `src/middleware/upload.ts` | Modified | Enforce authenticated scoped decryption, protected persistence, minimal sessions and safe diagnostics/caching. |
| `src/privacy/access.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/auth.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/catalogue.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/documents.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/encryptedClient.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/fieldEncryption.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/health.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/imports.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/migrateHealth.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/migratePackageJob.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/modelCodec.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/modules.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/operationalFields.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/packageJob.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/persistenceGuard.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/privacy.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/privacy.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/storageLocator.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/privacy/trust.integration.test.ts` | Added | Encryption policy, authenticated access/Prisma facade, migration support or privacy regression coverage. |
| `src/routes/auth.routes.ts` | Modified | Enforce authenticated scoped decryption, protected persistence, minimal sessions and safe diagnostics/caching. |
| `src/routes/documents.analysis.ts` | Modified | Preserve encrypted uploads/storage/API shape and PDF validation/page flows while removing local extraction dependencies. |
| `src/routes/documents.helpers.ts` | Modified | Preserve encrypted uploads/storage/API shape and PDF validation/page flows while removing local extraction dependencies. |
| `src/routes/documents.routes.ts` | Modified | Preserve encrypted uploads/storage/API shape and PDF validation/page flows while removing local extraction dependencies. |
| `src/routes/notifications.routes.ts` | Modified | Update extraction/integration behavior and operational documentation or redacted responses. |
| `src/scripts/auditDocumentStorage.ts` | Modified | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/backfillPackageSources.ts` | Modified | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/encryptExistingWealth.ts` | Modified | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/importDefaultPackagesFromEvents.ts` | Modified | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/localBackendEnvironment.ts` | Added | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/migrateDocumentTrustState.ts` | Modified | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/migratePrivateJobsAndExports.ts` | Added | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/migratePrivateRecords.ts` | Added | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/provisionPackagesAdmin.ts` | Modified | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/rewrapDocumentKeys.ts` | Modified | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/runLocalBackend.ts` | Added | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/scripts/verifyLocalPrivateWrites.ts` | Added | Protect offline persistence or add resumable backfills, guarded local startup and synthetic service verification. |
| `src/services/accountDeletion.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/accountExport.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/accountUsage.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/adminPackages.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/auth.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/customPackageGenerationQueue.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/documentAnalyzer/fileInput.ts` | Added | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/documentAnalyzer/index.ts` | Modified | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/documentAnalyzer/openaiDocumentAnalyzer.test.ts` | Modified | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/documentAnalyzer/openaiDocumentAnalyzer.ts` | Modified | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/documentAnalyzer/types.ts` | Modified | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/documentFileStorage.ts` | Modified | Preserve encrypted uploads/storage/API shape and PDF validation/page flows while removing local extraction dependencies. |
| `src/services/documentHybridEncryption.test.ts` | Modified | Preserve encrypted uploads/storage/API shape and PDF validation/page flows while removing local extraction dependencies. |
| `src/services/documentImportAnalysis.test.ts` | Added | Retain encrypted legacy/future integration support; remove dependency on obsolete local extraction. Routes remain disabled. |
| `src/services/documentImportAnalysis.ts` | Added | Retain encrypted legacy/future integration support; remove dependency on obsolete local extraction. Routes remain disabled. |
| `src/services/documentRules.service.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/documentSecurityValidation.ts` | Modified | Preserve encrypted uploads/storage/API shape and PDF validation/page flows while removing local extraction dependencies. |
| `src/services/documents/fieldDefinitions.ts` | Added | Retain manual metadata definitions/validation and legacy source labels without extraction. |
| `src/services/documents/fieldTypes.ts` | Added | Retain manual metadata definitions/validation and legacy source labels without extraction. |
| `src/services/documents/fieldValidation.ts` | Added | Retain manual metadata definitions/validation and legacy source labels without extraction. |
| `src/services/drive/oauth.ts` | Modified | Retain encrypted legacy/future integration support; remove dependency on obsolete local extraction. Routes remain disabled. |
| `src/services/drive/scanner.ts` | Modified | Retain encrypted legacy/future integration support; remove dependency on obsolete local extraction. Routes remain disabled. |
| `src/services/email/emailService.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/gmail/importer.ts` | Modified | Retain encrypted legacy/future integration support; remove dependency on obsolete local extraction. Routes remain disabled. |
| `src/services/gmail/oauth.ts` | Modified | Retain encrypted legacy/future integration support; remove dependency on obsolete local extraction. Routes remain disabled. |
| `src/services/health.service.ts` | Modified | Replace text/OCR with original-file AI; preserve clinical data on failed/disabled retries. |
| `src/services/healthExtraction.service.test.ts` | Added | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/healthExtraction.service.ts` | Modified | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/healthExtractionPrompt.ts` | Added | Send original documents/pages directly to AI, validate structured results, or test the AI boundary. |
| `src/services/ingestion/classifier/classifyDocument.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/documentDefinitions.registry.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/documentDefinitions.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/extractors/imageExtractor.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/extractors/index.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/extractors/officeExtractor.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/extractors/pdfExtractor.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/extractors/textExtractor.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/fieldExtractors/index.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/logger.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/normalizer/normalizeDocumentText.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/ocr/README.md` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/ocr/ocrConfig.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/ocr/ocrLayout.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/ocr/ocrScoring.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/ocr/ocrService.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/ocr/ocrTypes.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/ocr/ocrVariants.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/pipeline.test.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/pipeline.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/reviewFieldExtractor/candidateFields.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/reviewFieldExtractor/index.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/types.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/ingestion/validators/fileSignature.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/packs.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/pdfOperations.test.ts` | Added | Preserve encrypted uploads/storage/API shape and PDF validation/page flows while removing local extraction dependencies. |
| `src/services/readiness/capabilityResolver.ts` | Modified | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/readiness/defaultPacksRepository.ts` | Modified | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/readiness/documentMetadata.ts` | Modified | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/readiness/metadataMatcher.test.ts` | Modified | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/readiness/normalization.ts` | Modified | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/readiness/packageRefresh.service.test.ts` | Modified | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/readiness/packageRefresh.test.ts` | Modified | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/readiness/packageRefresh.testClient.ts` | Added | Preserve authorized matching/refresh, encrypted user catalogue data and manual-validator imports; update regressions. |
| `src/services/rules/engine.test.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/rules/engine.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/rules/genericRules.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/rules/helpers.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/rules/index.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/rules/types.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/services/storageCleanup.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/services/trustCenter.service.ts` | Modified | Integrate protected account/admin/export/auth/queue/storage/family persistence and authorization. |
| `src/types/word-extractor.d.ts` | Removed | Remove obsolete standalone extraction/OCR/rules implementation or its old tests/types. |
| `src/utils/authenticatedEncryption.ts` | Added | Strengthen authenticated encryption and preserve legacy decryption compatibility. |
| `src/utils/documentEncryption.ts` | Modified | Strengthen authenticated encryption and preserve legacy decryption compatibility. |
| `src/utils/jwt.ts` | Modified | Enforce authenticated scoped decryption, protected persistence, minimal sessions and safe diagnostics/caching. |
| `vercel.json` | Modified | Configure encryption/tooling; remove extraction packages/workers; add PDF structure support and verification commands. |

Outside tracked source: the normal local ignored `/Users/ranjith/code/backend/.env` received only previously missing private-data key configuration; existing values were retained. Ignored local `.secrets` contains an encrypted migration backup and a counts-only baseline, never plaintext keys. Temporary maintenance scripts under `/tmp` performed local-only preflight/backfill verification and are not deployment tools.
| `docs/privacy/data-api-hardening.sql` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `docs/privacy/manual-production-backup.md` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `docs/privacy/production-maintenance-preparation.md` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `docs/privacy/production-preflight.md` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `docs/privacy/secure-supabase-data-api.sql` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `docs/privacy/vercel-migration-runner.md` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `prisma/migrations/20261016120000_private_health_extraction_outcomes/migration.sql` | Added | Additive protection and raw-write guard for health extraction outcomes that disclose medical content. |
| `scripts/private-backup/README.md` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/allow-export-build.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/assemble.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/assemble.test.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/authenticate-legacy.ts` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/collect.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/consolidate.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/guards.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/guards.test.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/maintenance.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/parts.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/remote-storage-part.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/remote.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/restore.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/setup-local.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/test-hardening.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/transport.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `scripts/private-backup/transport.test.mjs` | Added | Secured recipient-encrypted production backup, complete Storage export, completeness checks, isolated restoration or retained-key authentication. |
| `src/privacy/productionTargetSummary.test.ts` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `src/privacy/productionTargetSummary.ts` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `src/privacy/vercelMigration.test.ts` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `src/privacy/vercelMigration.ts` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `src/scripts/runVercelBuild.ts` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `src/scripts/runVercelPrivateMigration.ts` | Added | Production recovery, migration, privacy verification or documented rollout evidence. |
| `src/scripts/verifyProductionPrivateWrites.ts` | Added | Guarded synthetic production service/API checks with cleanup and counts-only reports. |
