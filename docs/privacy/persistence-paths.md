# Static persistence and I/O index

Reviewed source index for Prisma reads/writes, transactions, raw SQL and storage/scratch I/O. This is discovery evidence, not a runtime authorization proof. Tests are excluded. Privacy enforcement is centralized in the codec/facade plus SQL constraints; route/service authorization remains necessary.

| Source | Lines |
|---|---|
| `src/infrastructure/storage/LocalStorageProvider.ts` | 36, 47 |
| `src/middleware/upload.ts` | 24 |
| `src/privacy/encryptedClient.ts` | 355 |
| `src/routes/bootstrap.routes.ts` | 20, 23 |
| `src/routes/documents.helpers.ts` | 237 |
| `src/routes/documents.routes.ts` | 157, 159, 204, 235, 309, 337, 358, 475, 483, 486, 495, 503, 509, 518, 530, 531, 539, 555, 589, 591, 594, 643, 658, 684, 690, 709, 711, 717, 718, 720, 738, 740, 753, 778, 793, 795, 801, 803, 805, 818, 837, 856, 869, 873, 875, 878, 890, 927 |
| `src/routes/drive.routes.ts` | 30, 63, 79, 82 |
| `src/routes/gmail.routes.ts` | 32, 65, 75, 91, 94, 95 |
| `src/routes/notifications.routes.ts` | 83 |
| `src/routes/packs.routes.ts` | 289, 294, 323 |
| `src/scripts/auditDocumentStorage.ts` | 110, 130, 136, 149, 162 |
| `src/scripts/backfillPackageSources.ts` | 80, 81, 109, 267 |
| `src/scripts/encryptExistingWealth.ts` | 11, 18, 27 |
| `src/scripts/importDefaultPackagesFromEvents.ts` | 154, 158, 166, 174, 180, 227, 234, 448 |
| `src/scripts/migrateDocumentTrustState.ts` | 18, 62, 98 |
| `src/scripts/migratePrivateJobsAndExports.ts` | 21, 29, 32, 33, 37, 49, 54, 71, 72, 73, 76, 84, 90, 92, 93, 104 |
| `src/scripts/migratePrivateRecords.ts` | 55, 60, 66, 108, 110, 111 |
| `src/scripts/rewrapDocumentKeys.ts` | 12, 43, 58 |
| `src/services/DocumentStorageService.ts` | 12, 25, 34, 38 |
| `src/services/accountDeletion.service.ts` | 15, 16, 21, 29, 31, 39, 52, 53, 54, 66 |
| `src/services/accountExport.service.ts` | 36, 41, 47, 60, 65, 103, 106, 108, 111, 112, 113, 114, 115, 116, 117, 118, 156, 161 |
| `src/services/accountUsage.service.ts` | 21, 31, 59, 62, 71, 76, 82, 89, 91, 98, 100 |
| `src/services/adminPackages.service.ts` | 185, 187, 216, 217, 224, 235, 243, 245, 274, 280, 286, 287, 309, 316, 318, 327, 410, 439 |
| `src/services/aiProcessing.service.ts` | 14 |
| `src/services/auth.service.ts` | 221, 251, 257, 280, 291, 329, 332, 371, 380, 387, 390, 391, 402, 481, 487, 504, 508, 521, 524, 528, 553, 557, 562, 563, 571, 585, 591, 592, 595, 614, 638, 653, 669, 675, 685, 691, 695, 721, 725, 731, 732, 735, 740, 750, 755, 760, 786, 790, 795, 796, 801, 802, 816, 825, 856, 865, 891, 914, 932, 933, 953, 963, 985, 1003, 1004, 1021, 1031, 1051 |
| `src/services/customPackageGenerationQueue.service.ts` | 84, 90, 108, 109, 110, 122, 125, 132, 153 |
| `src/services/digilocker/digilocker.service.ts` | 62, 74 |
| `src/services/documentAnalyzer/openaiDocumentAnalyzer.ts` | 255 |
| `src/services/documentFileStorage.ts` | 167, 188, 189, 220, 274, 429, 502, 519, 524 |
| `src/services/documentSecurityValidation.ts` | 218, 222 |
| `src/services/drive/oauth.ts` | 36, 51, 52, 54, 75, 89, 104, 120 |
| `src/services/drive/scanner.ts` | 165, 185, 199, 264, 267, 270, 273, 295, 302, 314, 318, 329, 335, 340, 370 |
| `src/services/email/emailService.ts` | 171 |
| `src/services/globalSearchSources.service.ts` | 63, 97, 98, 104, 165 |
| `src/services/gmail/importer.ts` | 87, 114, 118, 126, 136, 145 |
| `src/services/gmail/oauth.ts` | 36, 55, 56, 58, 80, 95, 110, 123 |
| `src/services/gmail/scanner.ts` | 53, 57, 62, 79, 83, 90, 100 |
| `src/services/health.service.ts` | 52, 86, 461, 472, 477, 484, 494, 510, 536, 540, 549, 558, 591, 599, 611, 622, 691, 726, 728, 744, 762, 787, 805, 819, 841, 851, 891, 892, 895, 898, 901, 904, 918, 942, 959, 973, 990, 997, 999, 1010, 1015, 1025, 1042, 1051, 1061, 1065, 1079, 1087, 1120, 1156, 1171, 1176, 1232, 1259, 1278, 1296, 1316, 1324, 1335 |
| `src/services/healthHome.service.ts` | 13 |
| `src/services/identity/ownershipDetection.ts` | 30, 78, 80, 106, 114 |
| `src/services/packs.service.ts` | 63, 91, 98, 144, 224, 225, 244, 282, 309, 363, 369, 396, 423, 449, 455, 456, 457, 479, 592 |
| `src/services/pushNotifications.service.ts` | 76, 88, 112, 120, 128 |
| `src/services/readiness/defaultPacksRepository.ts` | 23, 68, 69, 71, 81, 138, 143 |
| `src/services/readiness/packageRefresh.service.ts` | 13, 29, 35, 37, 44, 45, 48 |
| `src/services/readiness/readiness.service.ts` | 7 |
| `src/services/storageCleanup.service.ts` | 13, 20, 22, 26 |
| `src/services/trustCenter.service.ts` | 156, 178, 179, 184, 208, 209, 213, 246, 247, 249, 258, 260, 266, 284, 301, 309, 317, 319, 320, 325, 330, 351, 364, 373, 376, 387, 409, 420, 421, 422 |
| `src/services/userPreferences.service.ts` | 89, 107 |
| `src/services/wealthForm.service.ts` | 24, 25, 26, 88, 115, 124, 126, 136, 138 |
| `src/services/wealthHandoff.service.ts` | 57, 81, 85, 185 |
| `src/services/wealthHandoffContent.ts` | 69 |
| `src/services/wealthRecords.service.ts` | 24, 153, 163, 173, 187, 190, 205, 211, 214, 232, 234 |
| `src/utils/documentEncryption.ts` | 183 |

Standalone ingestion/OCR/extraction and rule pipelines were removed after this initial inventory. Manual field validation now lives under `src/services/documents`; active document/health extraction sends original files directly to AI. Gmail/Drive route mounts are commented out for future work.
