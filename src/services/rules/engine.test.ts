import assert from "node:assert/strict";
import { classifyDocument } from "../ingestion/classifier/classifyDocument";
import { analyzeWithRules } from "./engine";

const cases = [
  {
    name: "aadhaar with Pannala does not classify as pan",
    text: "Government of India\nUnique Identification Authority of India\nName: Sample User\nDOB: 01/01/1990\nMale\n2468 1357 9024",
    expected: "aadhaar",
  },
  {
    name: "pan with income tax department and pan number",
    text: "Income Tax Department\nPermanent Account Number\nName: Sample Person\nFather's Name: Example Parent\nQWERT4321P",
    expected: "pan",
  },
  {
    name: "passport with mrz",
    text: "Republic of India Passport\nPassport No: Z7654321\nP<INDSAMPLE<<PERSON<<<<<<<<<<<<<<<<<<<<<<<<",
    expected: "passport",
  },
  {
    name: "bank statement with balances and debit credit",
    text: "Bank Statement Account Number 123456 IFSC HDFC0001234 Opening Balance 1000 Closing Balance 2000 Debit Credit Transaction Date",
    expected: "bank_statement",
  },
  {
    name: "credit card statement beats bank statement",
    text: "Credit Card Statement Minimum Amount Due 500 Payment Due Date 01/01/2026 Credit Limit 100000 Card ending 1234",
    expected: "credit_card_statement",
  },
  {
    name: "payslip",
    text: "Payslip Salary Slip Gross Salary 100000 Net Pay 80000 Earnings Deductions HRA PF",
    expected: "payslip",
  },
  {
    name: "telangana driving licence",
    text: "TELANGANA STATE INDIAN UNION DRIVING LICENCE RTA SAMPLE TS99123456ABCD12",
    expected: "driving_license",
  },
  {
    name: "unknown text",
    text: "This is a random note about groceries and weekend plans with no document signals.",
    expected: "unknown",
  },
];

for (const item of cases) {
  const result = analyzeWithRules({ text: item.text, fileName: `${item.name}.txt` });
  assert.equal(result.documentType, item.expected, item.name);
}

const randomJpeg = analyzeWithRules({ text: "a landscape photo with no printed document text", fileName: "random.jpeg" });
assert.equal(randomJpeg.documentType, "unknown");

const filenameOnly = analyzeWithRules({ text: "a family holiday photo", fileName: "passport.jpg" });
assert.equal(filenameOnly.documentType, "unknown", "A filename must not be classification evidence.");

const oneWeakPassportSignal = analyzeWithRules({ text: "PASSPORT", fileName: "image.jpg" });
assert.equal(oneWeakPassportSignal.documentType, "unknown");
assert.notEqual(oneWeakPassportSignal.confidence, 100);

const incompletePassport = analyzeWithRules({
  text: "REPUBLIC OF INDIA PASSPORT\nZ7654321\nP<INDSAMPLE<<PERSON<<<<<<<<<<<<<<<<<<<<<<<<",
  fileName: "scan.jpg",
});
assert.equal(incompletePassport.documentType, "passport");
assert.ok(incompletePassport.confidence >= 70 && incompletePassport.confidence < 90);

const strongPassport = analyzeWithRules({
  text: [
    "REPUBLIC OF INDIA PASSPORT",
    "Passport No: Z7654321",
    "Surname: SAMPLE",
    "Given Name: PERSON",
    "Nationality: INDIAN",
    "Date of Birth: 01/01/1990",
    "Date of Expiry: 01/01/2030",
    "P<INDSAMPLE<<PERSON<<<<<<<<<<<<<<<<<<<<<<<<",
  ].join("\n"),
  fileName: "scan.jpg",
});
assert.equal(strongPassport.documentType, "passport");
assert.equal(strongPassport.confidence, 100);

const fallbackResult = classifyDocument({
  fileName: "angled-telangana-id-card.jpg",
  text: "TELANGANA RTA TS",
  hints: {
    ocr: {
      bestVariant: "card-crop:contrast:rot90",
      bestRotation: 90,
      variantCount: 12,
      keywordScore: 0,
      regexScore: 0,
      layoutSignals: ["cropped_id_card_aspect_ratio", "photo_area", "green_band_or_header", "green_text_band", "visible_chip", "chip_or_smart_card_layout"],
    },
  },
});
assert.equal(fallbackResult.documentType, "Indian Driving Licence");
assert.equal(fallbackResult.category, "identity");
assert.equal(fallbackResult.fields.state, "Telangana");
assert.equal(fallbackResult.fields.licenceNumber, undefined);
assert.equal(fallbackResult.fields.holderName, undefined);
assert.equal(fallbackResult.fields.address, undefined);
assert.equal(fallbackResult.fields.issuingAuthority, "RTA");
assert.equal(fallbackResult.fields.issueDate, undefined);
assert.ok(fallbackResult.confidence >= 70);

const firstDynamicDl = classifyDocument({
  fileName: "fake-dl-one.txt",
  text: "INDIAN UNION DRIVING LICENCE TELANGANA STATE RTA SAMPLE Licence No: KA22123456ABCD90 Issued on 05/08/2021 Address: Sample Road, Test City",
});
assert.equal(firstDynamicDl.fields.licenceNumber, "KA22123456ABCD90");
assert.equal(firstDynamicDl.fields.issueDate, "05/08/2021");
assert.equal(firstDynamicDl.fields.address, "Sample Road, Test City");

const secondDynamicDl = classifyDocument({
  fileName: "fake-dl-two.txt",
  text: "DRIVING LICENCE LICENSING AUTHORITY RTA EXAMPLE MH45111ZXCVB222 Issue Date 09-10-2022",
});
assert.equal(secondDynamicDl.fields.licenceNumber, "MH45111ZXCVB222");

console.log(`rule tests passed: ${cases.length}`);
