# Package source restoration and release validation — 25 October 2026

The encryption migration archived and cleared the public seed source columns. Restore references only from the reviewed public dataset, matching both package ID and slug. Do not decrypt or republish legacy catalogue metadata, restore search queries, or rewrite requirements/assignments.

## Production restoration

- Target: existing readiness Supabase project `izsujcwyuirkzkafhfnp`.
- Before: 66 live seed packages, none with public source references.
- Restored: 121 reviewed references for 63 matching seed packages.
- Keep original review date, `needs_review` status, and null `lastVerifiedAt`. Restoration is not a new checklist verification.
- A transaction requires all 63 target rows to retain empty source fields before writing; concurrent changes abort the restoration. Requirement, assignment, and private-package counts are checked in the same transaction.
- Public source metadata snapshot captured before the operation. No private archives, documents, custom packages, or assignments are restored or overwritten.
- Two rental packages have no accepted checklist sources because jurisdiction is unspecified. The additional operator-created Coffee seed package is outside the reviewed dataset. These three rows remain unchanged.

The guarded statement is generated with `node --import tsx src/scripts/prepareReviewedSourceRestore.ts --output /tmp/reviewed-sources.sql`. It is intentionally not an automatic deployment hook and aborts if its expected empty target state is no longer present.

## Link availability

Checked all 108 unique reviewed URLs (121 references) using bounded GET requests on 25 October 2026: 96 responded with successful HTTP statuses; 12 were unavailable to the automated client. HTTP availability does not prove a checklist is complete, current, or applicable to every user.

Unavailable to the client:

- Melbourne undergraduate entry requirements: 403.
- Oxford graduate supporting document requirements: 403.
- West Bengal pension checklist (SAI): connection failure.
- Passport India Annexure F, Annexure D, and Visakhapatnam checklist: 503.
- AuthBridge background verification article: 403.
- Both Upwork identity/business verification articles: 403.
- IIT Bombay medical claim form: connection failure.
- SpringVerify background verification article: 500.
- LIC form 3750e-1: timeout.

These are retained as previously reviewed references, not certified as currently available. The competitive-exam source is specific to the closed UPSC 2026 cycle; it does not verify a complete current UPSC/SSC/banking checklist.

Reproduce the availability audit with `node src/scripts/checkReviewedSourceLinks.mjs --output /tmp/readines-source-links.json`.

## Refresh behavior

AI returns requirements and source links for user/admin review in one web-research request. The backend does not download HTML/PDF source pages or verify verbatim evidence. It compares and atomically saves the package, preserves stable requirement IDs, and retains retired requirements with their assignments. AI reference entries remain `needs_review`; refresh clears `lastVerifiedAt` and never grants admin verification.

A successful response returns `refreshed: true`. When requirements and applicability are unchanged, it returns `changed: false` with “Refreshed — no changes in this package.” Dates and reference-review metadata alone do not increment the version. Provider failures, malformed output, authentication, quotas, and concurrency failures remain actual errors. The prior HTTP-200 `verified: false` source-verification outcome has been removed.

The changed and unchanged outcomes were exercised in local Chrome. Five additional local packages (Canada visa, New job onboarding, Renting out property, Driving license renewal, Employer medical reimbursement) each returned HTTP 200 and persisted requirements and source links. The normal three-action quota returned 429 during testing; disposable accounts were used, with no real account quota edits.

## Extra package documents

Every package displays “Add another document,” including zero-readiness packages. Existing vault documents can be included in the download independently of required-document readiness. The same picker offers “Upload and scan a document.” This reuses normal document analysis/save, preselects AI scanning when the account allows it, retains detected types, and defaults undetected types to Other. After review and save, the file joins the package download; a matching recognized document also participates in ordinary readiness calculation. Account-level AI settings remain enforced.

Regression checks cover scanned and manual uploads, Other fallback, selection at zero readiness, source references without backend downloads, changed/no-change refresh, ownership, stable IDs, and concurrency protection.
