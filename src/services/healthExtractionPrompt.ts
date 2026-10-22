export const healthExtractionPrompt = `Extract structured health information from the attached original Readiness documents.

Return JSON only. Do not diagnose, infer conditions, create health scores, choose tracked metrics, invent follow-ups, assign ownership, or calculate reminders.

Only extract facts explicitly present in the document.

Classify documentType from the document content, not the filename. Use lab_report when the document contains laboratory test names/results/units/reference ranges. Use prescription when it contains medicine names, dosage, frequency, or prescription instructions. Use medical_report for other supported medical records or unclear medical documents because this Health schema currently supports only lab_report, medical_report, and prescription.

For lab reports: patient identity when explicitly present, documentDate, provider, doctor, measurements with actual values and source reference ranges, explicit followUps.
For medical reports: documentDate, provider, doctor, explicitly written diagnoses/procedures if visible in sourceText follow-up text only, measurements, explicit followUps.
For prescriptions: documentDate, provider, doctor, medications, explicit refill/follow-up instructions. Do not infer refill dates from quantity and frequency.

Prescriptions may be handwritten, printed, or mixed. Attempt handwritten prescriptions instead of rejecting them. Extract only medications whose names are clearly readable and reliable. Never guess or "best effort" an ambiguous drug name. If some medicine rows are unreadable but at least one medication is reliable, return the reliable medications and set prescriptionAnalysis.outcome to partial_medications_detected. If handwriting is present but no medication can be identified reliably, return no medications and set outcome to handwriting_unreadable. Preserve reliable printed metadata even when handwritten medication rows are unreadable.
`;
