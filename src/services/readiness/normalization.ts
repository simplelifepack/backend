const explicitTypeMap: Record<string, string> = {
  aadhaar: "aadhaar",
  aadhar: "aadhaar",
  pan: "pan",
  pan_card: "pan",
  permanent_account_number: "pan",
  passport: "passport",
  driving_license: "driving_licence",
  driving_licence: "driving_licence",
  driver_license: "driving_licence",
  indian_driving_licence: "driving_licence",
  indian_driving_license: "driving_licence",
  voter_id: "voter_id",
  birth_certificate: "birth_certificate",
  death_certificate: "death_certificate",
  marriage_certificate: "marriage_certificate",
  payslip: "salary_slip",
  pay_slip: "salary_slip",
  salary_slip: "salary_slip",
  bank_statement: "bank_statement",
  form16: "form_16",
  form_16: "form_16",
  itr: "itr",
  income_tax_return: "itr",
  photo: "photo",
  passport_photo: "passport_photo",
  passport_size: "passport_photo",
  passport_size_photo: "passport_photo",
  passport_size_photograph: "passport_photo",
  passport_size_image: "passport_photo",
  passport_sized_photo: "passport_photo",
  passport_sized_photograph: "passport_photo",
  id_photo: "passport_photo",
  headshot: "passport_photo",
  utility_bill: "utility_bill",
  rental_agreement: "rental_agreement",
  sale_deed: "sale_deed",
  registered_sale_deed: "sale_deed",
  conveyance_deed: "sale_deed",
  title_deed: "sale_deed",
  property_sale_deed: "sale_deed",
  property_tax_receipt: "property_tax_receipt",
  degree_certificate: "degree_certificate",
  marks_memo: "marksheet",
  marksheet: "marksheet",
  school_certificate: "school_certificate",
  transfer_certificate: "transfer_certificate",
  migration_certificate: "migration_certificate",
  medical_report: "medical_report",
  lab_report: "medical_report",
  discharge_summary: "medical_report",
  hospital_bill: "hospital_bill",
  health_insurance: "insurance_policy",
  health_insurance_card: "insurance_policy",
  life_insurance: "insurance_policy",
  vehicle_insurance: "insurance_policy",
  travel_insurance: "insurance_policy",
  insurance_policy: "insurance_policy",
  offer_letter: "employment_letter",
  appointment_letter: "employment_letter",
  employment_contract: "employment_letter",
  employment_letter: "employment_letter",
  experience_letter: "experience_letter",
  relieving_letter: "relieving_letter",
  pf_statement: "pf_statement",
  gst_certificate: "gst_certificate",
  business_registration: "business_registration",
  partnership_deed: "partnership_deed",
  llp_agreement: "llp_agreement",
  company_incorporation_certificate: "company_incorporation_certificate",
  cancelled_cheque: "cancelled_cheque",
  address_proof: "address_proof",
  identity_proof: "identity_proof",
  income_proof: "income_proof",
  application_form: "application_form",
  affidavit: "affidavit",
  police_verification: "police_verification",
  encumbrance_certificate: "encumbrance_certificate",
  khata_certificate: "property_sale_deed",
  occupancy_certificate: "property_sale_deed",
  rc_book: "vehicle_registration",
  puc_certificate: "vehicle_puc",
  vaccination_certificate: "vaccination_certificate",
  bonafide_certificate: "bonafide_certificate",
  transcript: "transcript",
  passbook: "bank_statement",
  fixed_deposit: "bank_statement",
  loan_statement: "bank_statement",
  statement: "bank_statement",
  credit_card_statement: "bank_statement",
};

const textSignals: Array<[RegExp, string]> = [
  [/\baadhaar|uidai|unique identification authority\b/i, "aadhaar"],
  [/\bpermanent account number|income tax department|[A-Z]{5}[0-9]{4}[A-Z]\b/i, "pan"],
  [/\bpassport[\s_-]*(?:size|sized)(?:[\s_-]*(?:photo|photograph|picture|image))?\b|\bpassport[\s_-]*(?:photo|photograph|picture|image)\b|\bheadshot\b/i, "passport_photo"],
  [/\bpassport\b|republic of india/i, "passport"],
  [/\bindian union driving licen[cs]e|indian driving licen[cs]e|driving licen[cs]e|dl no\b/i, "driving_licence"],
  [/\bvoter id|election commission|elector photo identity card\b/i, "voter_id"],
  [/\bbirth certificate\b/i, "birth_certificate"],
  [/\bdeath certificate\b/i, "death_certificate"],
  [/\bmarriage certificate\b/i, "marriage_certificate"],
  [/\bsalary slip|payslip|gross salary|net pay\b/i, "salary_slip"],
  [/\bbank statement|account statement|ifsc\b/i, "bank_statement"],
  [/\bform 16|certificate under section 203\b/i, "form_16"],
  [/\bincome tax return|itr acknowledgement\b/i, "itr"],
  [/\butility bill|electricity bill|water bill|gas bill\b/i, "utility_bill"],
  [/\brental agreement|lease agreement\b/i, "rental_agreement"],
  [/\bsale deed|title deed|conveyance deed\b/i, "sale_deed"],
  [/\bproperty tax receipt\b/i, "property_tax_receipt"],
  [/\bdegree certificate|convocation\b/i, "degree_certificate"],
  [/\bschool certificate|school leaving certificate\b/i, "school_certificate"],
  [/\bmarksheet|statement of marks|marks memo\b/i, "marksheet"],
  [/\btransfer certificate\b/i, "transfer_certificate"],
  [/\bmigration certificate\b/i, "migration_certificate"],
  [/\bmedical report|diagnosis|clinical history|lab report|discharge summary\b/i, "medical_report"],
  [/\bhospital bill|final bill|hospital invoice\b/i, "hospital_bill"],
  [/\binsurance|policy schedule|policy number\b/i, "insurance_policy"],
  [/\boffer letter|appointment letter|employment contract\b/i, "employment_letter"],
  [/\bexperience letter\b/i, "experience_letter"],
  [/\brelieving letter\b/i, "relieving_letter"],
  [/\bgst certificate|gstin\b/i, "gst_certificate"],
  [/\bpartnership deed\b/i, "partnership_deed"],
  [/\bllp agreement\b/i, "llp_agreement"],
  [/\bcertificate of incorporation|cin\b/i, "company_incorporation_certificate"],
  [/\bcancelled cheque\b/i, "cancelled_cheque"],
  [/\baffidavit|notary|deponent\b/i, "affidavit"],
  [/\bpolice verification|police clearance\b/i, "police_verification"],
];

export function normalizeDocumentType(input?: string | null, text?: string | null) {
  const normalizedInput = (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (explicitTypeMap[normalizedInput]) {
    return explicitTypeMap[normalizedInput];
  }

  const haystack = `${input ?? ""} ${text ?? ""}`;
  const match = textSignals.find(([pattern]) => pattern.test(haystack));
  return match?.[1] ?? (normalizedInput || "unknown");
}

const genericRequirementTypes = new Set([
  "government_id", "government_id_address", "bank_proof", "form", "agreement",
  "authorization", "signature_proof", "identity_document", "document",
]);

export function normalizeRequirementDocumentTypes(documentType: string, title: string) {
  const primary = normalizeDocumentType(documentType);
  if (!genericRequirementTypes.has(primary)) return [primary];
  const inferred = textSignals.filter(([pattern]) => pattern.test(title)).map(([, type]) => normalizeDocumentType(type));
  return [...new Set(inferred.length ? inferred : [primary])];
}

export function normalizeSearchText(input: string) {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/\bhouse\b/g, "home")
    .replace(/\bcar finance\b/g, "car vehicle loan")
    .replace(/\bauto finance\b/g, "auto vehicle loan")
    .replace(/\bautomobile loan\b/g, "automobile vehicle loan")
    .replace(/\bdemat\b/g, "trading demat")
    .replace(/\bdematerialised\b/g, "demat")
    .replace(/\bdematerialized\b/g, "demat")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:i want|i need|need|want|help me|please|documents for|document for|requirements for|required documents for|docs for|open|apply for|create|build|get|start)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return singularizeSearchTerms(normalized);
}

export function slugify(input: string) {
  return normalizeSearchText(input).replace(/\s+/g, "-");
}

function singularizeSearchTerms(input: string) {
  return input
    .split(" ")
    .map((token) => {
      if (token.length <= 3) return token;
      if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
      if (token.endsWith("sses")) return token.slice(0, -2);
      if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
      return token;
    })
    .join(" ");
}
