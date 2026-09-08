/* eslint-disable max-lines */
import type { DocumentOwner } from "./metadataTypes";
import { normalizeDocumentType, slugify } from "./normalization";
import { sourceMetadataForSeed } from "./readinessPackSources";
import type { PackageSearchMetadata } from "./searchMetadata";

export type SeedRequirement = {
  title: string;
  description: string;
  required: boolean;
  group: string;
  acceptedDocumentTypes: string[];
  alternativeLabels: string[];
  documentType: string;
  owner: DocumentOwner;
  metadata?: Record<string, string | number | boolean | null>;
};

export type SeedReadinessPack = {
  slug: string;
  title: string;
  subtitle?: string;
  category: string;
  aliases: string[];
  description: string;
  sourceType?: string;
  sourceName?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  lastCheckedAt?: Date;
  verificationSources?: VerificationSource[];
  lastVerifiedAt?: Date;
  verificationStatus?: "verified" | "needs_review";
  requirements: SeedRequirement[];
  searchMetadata: PackageSearchMetadata;
};

export type VerificationSource = {
  title: string;
  organization: string;
  url: string;
  type: "government" | "official" | "bank" | "university" | "insurance" | "authority";
  retrievedAt: string;
};

type RequirementTemplate = Omit<SeedRequirement, "required">;
type RequirementRef = string | {
  key: string;
  required?: boolean;
  owner?: DocumentOwner;
  title?: string;
  group?: string;
};

const requirementCatalog: Record<string, RequirementTemplate> = {
  application: req("Application Form", "Completed and signed application or request form.", "Other", ["application_form"], ["Application Form", "Filled Form"]),
  identity: req("Identity Proof", "Government-issued proof of identity.", "KYC", ["aadhaar", "pan", "passport", "driving_licence", "voter_id", "identity_proof"], ["Aadhaar Card", "PAN Card", "Passport", "Driving Licence", "Voter ID"]),
  aadhaar: req("Aadhaar Card", "Aadhaar or masked Aadhaar for identity or address verification.", "KYC", ["aadhaar"], ["Aadhaar", "UIDAI Aadhaar"]),
  pan: req("PAN Card", "Permanent Account Number card for tax and KYC checks.", "KYC", ["pan"], ["PAN", "Permanent Account Number"]),
  passport: req("Passport", "Valid or previous passport booklet.", "Travel", ["passport"], ["Indian Passport", "Old Passport"]),
  voter: req("Voter ID", "Elector photo identity card.", "KYC", ["voter_id"], ["EPIC", "Voter ID"]),
  drivingLicence: req("Driving Licence", "Valid driving licence issued by an RTO.", "KYC", ["driving_licence"], ["Driving License", "DL"]),
  address: req("Address Proof", "Recent proof of current residential address.", "KYC", ["aadhaar", "utility_bill", "rental_agreement", "passport", "driving_licence"], ["Utility Bill", "Rental Agreement", "Aadhaar", "Passport"]),
  dob: req("Date of Birth Proof", "Proof of date of birth.", "KYC", ["birth_certificate", "school_certificate", "passport", "aadhaar"], ["Birth Certificate", "Passport", "School Certificate", "School Marksheet"]),
  photo: req("Photograph", "Recent passport-size photograph.", "KYC", ["passport_photo", "passport_size_photo", "photo"], ["Passport Photo", "Passport Size Photo", "Photograph"]),
  affidavit: req("Legal Affidavit", "Notarized affidavit or self-declaration where required.", "Legal", ["affidavit"], ["Affidavit", "Notary Affidavit"]),
  police: req("Police Verification", "Police verification certificate or clearance report.", "Verification", ["police_verification"], ["Police Verification", "Police Clearance Certificate"]),
  income: req("Income Proof", "Proof of income such as salary slip, Form 16, or ITR.", "Income", ["salary_slip", "form_16", "itr", "income_proof"], ["Salary Slip", "Form 16", "ITR", "Income Certificate"]),
  salary: req("Salary Slips", "Recent salary slips for income assessment.", "Income", ["salary_slip"], ["Salary Slip", "Payslip"], { maxAgeDays: 90 }),
  bank: req("Bank Statement", "Recent bank statement or passbook.", "Bank", ["bank_statement"], ["Bank Statement", "Passbook"], { maxAgeDays: 180 }),
  loanStatement: req("Existing Loan Statement", "Current loan account statement or repayment track record.", "Bank", ["bank_statement"], ["Loan Statement", "Repayment Schedule", "Loan Account Statement"]),
  form16: req("Form 16", "Latest Form 16 or TDS certificate.", "Income", ["form_16"], ["Form 16", "TDS Certificate"]),
  itr: req("Income Tax Return", "Latest ITR acknowledgement or return filing proof.", "Tax", ["itr"], ["ITR", "Income Tax Return", "ITR Acknowledgement"]),
  cancelledCheque: req("Cancelled Cheque", "Cancelled cheque or bank proof for payouts.", "Bank", ["cancelled_cheque", "bank_statement"], ["Cancelled Cheque", "Bank Account Proof"]),
  propertyDeed: req("Property Title Document", "Sale deed or title deed for the property.", "Property", ["property_sale_deed"], ["Sale Deed", "Title Deed", "Conveyance Deed"]),
  propertyTax: req("Property Tax Receipt", "Latest property tax paid receipt.", "Property", ["property_tax_receipt"], ["Property Tax Receipt"]),
  encumbrance: req("Encumbrance Certificate", "Encumbrance certificate for the relevant property period.", "Property", ["encumbrance_certificate"], ["EC", "Encumbrance Certificate"]),
  rental: req("Rental Agreement", "Registered or notarized rental or lease agreement.", "Property", ["rental_agreement"], ["Rental Agreement", "Lease Agreement"]),
  academic: req("Academic Records", "Marksheets, certificates, or transcripts.", "Education", ["marksheet", "degree_certificate", "transcript"], ["Marksheet", "Degree Certificate", "Transcript"]),
  marksheet: req("Marksheets", "Relevant school or college marksheets.", "Education", ["marksheet"], ["Marksheet", "Statement of Marks"]),
  degree: req("Degree Certificate", "Degree or provisional certificate.", "Education", ["degree_certificate"], ["Degree Certificate", "Provisional Certificate"]),
  transcript: req("Transcript", "Official academic transcript.", "Education", ["transcript"], ["Transcript", "Grade Transcript"]),
  transfer: req("Transfer Certificate", "Transfer certificate from previous institution.", "Education", ["transfer_certificate"], ["Transfer Certificate", "TC"]),
  migration: req("Migration Certificate", "Migration certificate from school board or university.", "Education", ["migration_certificate"], ["Migration Certificate"]),
  medical: req("Medical Records", "Medical report, prescription, discharge summary, or test results.", "Medical", ["medical_report"], ["Medical Report", "Discharge Summary", "Lab Report"]),
  hospitalBill: req("Hospital Bill", "Hospital bill or estimate.", "Medical", ["hospital_bill"], ["Hospital Bill", "Hospital Invoice"]),
  insurance: req("Insurance Policy", "Active insurance policy or health card.", "Insurance", ["insurance_policy"], ["Insurance Policy", "Health Insurance Card", "Policy Schedule"]),
  employment: req("Employment Proof", "Employment letter, offer letter, or appointment letter.", "Employment", ["employment_letter"], ["Offer Letter", "Appointment Letter", "Employment Letter"]),
  experience: req("Experience Certificate", "Experience letter from employer.", "Employment", ["experience_letter"], ["Experience Letter", "Service Certificate"]),
  relieving: req("Relieving Letter", "Relieving or resignation acceptance letter.", "Employment", ["relieving_letter"], ["Relieving Letter", "Exit Letter"]),
  pf: req("PF Statement", "EPF passbook, UAN statement, or PF transfer proof.", "Employment", ["pf_statement"], ["PF Statement", "EPF Passbook", "UAN Statement"]),
  relationship: req("Relationship Proof", "Document proving relationship with applicant or claimant.", "Family", ["marriage_certificate", "birth_certificate", "identity_proof"], ["Marriage Certificate", "Birth Certificate", "Family Proof"]),
  birth: req("Birth Certificate", "Birth certificate issued by local authority.", "Family", ["birth_certificate"], ["Birth Certificate"]),
  death: req("Death Certificate", "Death certificate issued by local authority.", "Family", ["death_certificate"], ["Death Certificate"]),
  marriage: req("Marriage Certificate", "Marriage certificate or marriage proof.", "Family", ["marriage_certificate"], ["Marriage Certificate"]),
  utility: req("Utility Bill", "Recent utility bill for service address.", "Utilities", ["utility_bill"], ["Electricity Bill", "Water Bill", "Gas Bill", "Broadband Bill"]),
  gst: req("GST Certificate", "GST registration certificate or GSTIN proof.", "Business", ["gst_certificate"], ["GST Certificate", "GSTIN"]),
  business: req("Business Registration", "Shop act, Udyam, or business registration proof.", "Business", ["business_registration"], ["Business Registration", "Udyam", "Shop Act"]),
  partnership: req("Partnership Deed", "Signed partnership deed.", "Business", ["partnership_deed"], ["Partnership Deed"]),
  llp: req("LLP Agreement", "LLP agreement and registration proof.", "Business", ["llp_agreement"], ["LLP Agreement"]),
  incorporation: req("Company Incorporation Certificate", "Certificate of incorporation or CIN proof.", "Business", ["company_incorporation_certificate"], ["Certificate of Incorporation", "CIN Certificate"]),
  vehicle: req("Vehicle Registration", "Vehicle registration certificate.", "Vehicle", ["vehicle_registration"], ["RC Book", "Registration Certificate"]),
  puc: req("PUC Certificate", "Valid pollution under control certificate.", "Vehicle", ["vehicle_puc"], ["PUC Certificate"]),
  vaccination: req("Vaccination Certificate", "Vaccination certificate or immunization record.", "Medical", ["vaccination_certificate"], ["Vaccination Certificate", "Cowin Certificate"]),
  bonafide: req("Bonafide Certificate", "Current student bonafide certificate.", "Education", ["bonafide_certificate"], ["Bonafide Certificate", "Student Certificate"]),
};

function req(title: string, description: string, group: string, acceptedDocumentTypes: string[], alternativeLabels: string[], metadata?: Record<string, string | number | boolean | null>): RequirementTemplate {
  return {
    title,
    description,
    group,
    documentType: normalizeDocumentType(acceptedDocumentTypes[0]),
    owner: "self",
    acceptedDocumentTypes: acceptedDocumentTypes.map((type) => normalizeDocumentType(type)),
    alternativeLabels,
    metadata,
  };
}

function pack(title: string, category: string, aliases: string[], refs: RequirementRef[], description?: string, metadata: Partial<Pick<SeedReadinessPack, "lastCheckedAt" | "lastVerifiedAt" | "searchMetadata" | "sourceName" | "sourceTitle" | "sourceType" | "sourceUrl" | "subtitle" | "verificationSources" | "verificationStatus">> = {}): SeedReadinessPack {
  const source = metadata.sourceTitle && metadata.sourceUrl
    ? metadata
    : sourceMetadataForSeed(title, category);
  return {
    slug: slugify(title),
    title,
    ...source,
    ...metadata,
    category,
    aliases,
    description: description ?? `${title} readiness pack with the commonly requested Indian-context documents.`,
    searchMetadata: metadata.searchMetadata ?? { intent: category, subject: title, searchPhrases: aliases },
    requirements: refs.map((ref) => {
      const key = typeof ref === "string" ? ref : ref.key;
      const template = requirementCatalog[key];
      if (!template) throw new Error(`Unknown readiness requirement: ${key}`);
      return {
        ...template,
        required: typeof ref === "string" ? true : ref.required ?? true,
        owner: typeof ref === "string" ? template.owner : ref.owner ?? template.owner,
        title: typeof ref === "string" ? template.title : ref.title ?? template.title,
        group: typeof ref === "string" ? template.group : ref.group ?? template.group,
      };
    }),
  };
}

export const readinessPackSeeds: SeedReadinessPack[] = [
  pack("Aadhaar Card", "Identity & Government", ["aadhaar enrolment", "uidai"], ["application", "identity", "address", "dob", "photo"]),
  pack("PAN Card", "Identity & Government", ["pan application", "permanent account number"], ["application", "identity", "address", "dob", "photo"]),
  pack("Passport Application Pack", "Identity & Government", ["passport", "new passport", "fresh passport", "passport application"], ["aadhaar", "pan", "dob", "address", "photo", { key: "police", required: false }]),
  pack("Passport Renewal", "Identity & Government", ["renew passport", "passport reissue"], ["application", "passport", "address", "photo", { key: "police", required: false }]),
  pack("Driving Licence New", "Identity & Government", ["new driving licence", "new dl"], ["application", "identity", "address", "dob", "photo"]),
  pack("Driving Licence Renewal", "Identity & Government", ["dl renewal", "renew driving licence"], ["application", "drivingLicence", "address", "photo"]),
  pack("Voter ID", "Identity & Government", ["epic", "voter card"], ["application", "identity", "address", "dob", "photo"]),
  pack("Birth Certificate", "Identity & Government", ["birth registration"], ["application", "identity", "address", "hospitalBill", { key: "affidavit", required: false }]),
  pack("Death Certificate", "Identity & Government", ["death registration"], ["application", "medical", "identity", "relationship", { key: "hospitalBill", required: false }]),
  pack("Marriage Certificate", "Identity & Government", ["marriage registration certificate"], ["application", "identity", "address", "photo", "affidavit"]),
  pack("Name Change", "Identity & Government", ["change name", "gazette name change"], ["identity", "address", "affidavit", "photo", { key: "marriage", required: false }]),
  pack("Address Change", "Identity & Government", ["change address", "address update"], ["identity", "address", "application", { key: "rental", required: false }]),
  pack("Police Clearance Certificate", "Identity & Government", ["pcc", "police clearance"], ["application", "identity", "address", "passport", "photo"]),
  pack("Income Certificate", "Identity & Government", ["income proof certificate"], ["application", "identity", "address", "income", "bank"]),
  pack("Caste Certificate", "Identity & Government", ["community certificate"], ["application", "identity", "address", "birth", "affidavit"]),
  pack("Domicile Certificate", "Identity & Government", ["residence certificate"], ["application", "identity", "address", "birth", { key: "utility", required: false }]),
  pack("Disability Certificate", "Identity & Government", ["pwd certificate"], ["application", "identity", "address", "medical", "photo"]),
  pack("Ration Card", "Identity & Government", ["ration card application"], ["application", "identity", "address", "relationship", "income"]),
  pack("Senior Citizen Card", "Identity & Government", ["senior citizen id"], ["application", "identity", "address", "dob", "photo"]),
  pack("e-Shram Registration", "Identity & Government", ["eshram", "unorganised worker card"], ["aadhaar", "bank", "cancelledCheque", { key: "income", required: false }]),

  pack("Savings Account Opening", "Banking & Finance", ["open savings account"], ["identity", "pan", "address", "photo", { key: "income", required: false }]),
  pack("Current Account Opening", "Banking & Finance", ["open current account"], ["identity", "pan", "address", "business", "gst", "photo"]),
  pack("Home Loan", "Banking & Finance", ["housing loan", "loan for house", "house loan"], ["identity", "pan", "address", "salary", "bank", "itr", "propertyDeed", { key: "propertyTax", required: false }], "Documents usually requested before a lender can assess KYC, income, bank history, and property eligibility."),
  pack("Home Loan Balance Transfer", "Banking & Finance", ["home loan transfer", "balance transfer"], ["identity", "pan", "bank", "itr", "propertyDeed", "loanStatement", { key: "propertyTax", required: false }]),
  pack("Personal Loan", "Banking & Finance", ["instant personal loan"], ["identity", "pan", "address", "salary", "bank", { key: "itr", required: false }]),
  pack("Car Loan", "Banking & Finance", ["auto loan"], ["identity", "pan", "address", "bank", "income", "drivingLicence"]),
  pack("Bike Loan", "Banking & Finance", ["two wheeler loan", "motorcycle loan"], ["identity", "pan", "address", "bank", "income"], undefined, { searchMetadata: { intent: "vehicle financing", subject: "bike", searchPhrases: ["buy a bike with finance", "finance a motorcycle", "purchase a two wheeler on loan"] } }),
  pack("Gold Loan", "Banking & Finance", ["loan against gold"], ["identity", "pan", "address", "bank", { key: "income", required: false }]),
  pack("Education Loan", "Banking & Finance", ["student education loan"], ["identity", "pan", "address", "academic", "income", "bank", "bonafide"]),
  pack("Credit Card Application", "Banking & Finance", ["apply credit card", "bank credit card"], ["identity", "pan", "address", "salary", "bank", { key: "itr", required: false }], undefined, { searchMetadata: { intent: "credit card", subject: "credit card", searchPhrases: ["card from bank for spending", "apply for a credit card", "get a credit card"] } }),
  pack("Fixed Deposit", "Banking & Finance", ["fd opening"], ["identity", "pan", "address", "bank", "cancelledCheque"]),
  pack("Demat Account", "Banking & Finance", ["trading account", "brokerage account"], ["identity", "pan", "address", "bank", "cancelledCheque", "photo"]),
  pack("Mutual Fund KYC", "Banking & Finance", ["mf kyc", "cams kyc"], ["identity", "pan", "address", "bank", "photo"]),
  pack("NPS Registration", "Banking & Finance", ["national pension system"], ["identity", "pan", "address", "bank", "photo"]),
  pack("EPF Withdrawal", "Banking & Finance", ["pf withdrawal", "epf claim"], ["identity", "pan", "bank", "cancelledCheque", "pf", { key: "employment", required: false }]),

  pack("Income Tax Filing", "Tax & Legal", ["tax filing", "itr filing", "file income tax"], ["pan", "form16", "bank", "itr", { key: "income", required: false }], "A practical checklist for filing an income tax return with PAN, income, TDS, and bank proofs."),
  pack("GST Registration", "Tax & Legal", ["register gst"], ["pan", "identity", "address", "business", "bank", "photo"]),
  pack("GST Return Filing", "Tax & Legal", ["gst filing", "gstr"], ["gst", "business", "bank", { key: "itr", required: false }]),
  pack("Business Registration", "Tax & Legal", ["start business"], ["identity", "pan", "address", "business", "bank"]),
  pack("Sole Proprietorship", "Tax & Legal", ["proprietor registration"], ["identity", "pan", "address", "business", "bank", { key: "gst", required: false }]),
  pack("Partnership Registration", "Tax & Legal", ["partnership firm"], ["identity", "pan", "address", "partnership", "bank"]),
  pack("LLP Registration", "Tax & Legal", ["limited liability partnership"], ["identity", "pan", "address", "llp", "bank"]),
  pack("Private Limited Company", "Tax & Legal", ["pvt ltd", "company registration"], ["identity", "pan", "address", "incorporation", "bank"]),
  pack("Trademark Registration", "Tax & Legal", ["trademark application"], ["identity", "pan", "business", "application", { key: "incorporation", required: false }]),
  pack("Property Registration", "Tax & Legal", ["register property", "sale deed registration"], ["identity", "pan", "address", "propertyDeed", "encumbrance", "propertyTax"], "Checklist for a property registration desk: KYC, PAN, ownership papers, tax receipts, and EC."),

  pack("Hospital Admission", "Healthcare", ["admit to hospital", "hospitalization"], ["identity", "address", "insurance", "medical", { key: "cancelledCheque", required: false }], "Hospital admission readiness covering patient KYC, insurance, and medical records."),
  pack("Health Insurance Claim", "Healthcare", ["medical insurance claim", "cashless claim"], ["identity", "insurance", "medical", "hospitalBill", "bank", "cancelledCheque"]),
  pack("Life Insurance Claim", "Healthcare", ["death claim", "life policy claim"], ["identity", "insurance", "death", "relationship", "bank", "cancelledCheque"]),
  pack("Medical Reimbursement", "Healthcare", ["reimburse medical bills"], ["identity", "medical", "hospitalBill", "bank", "employment"]),
  pack("Organ Donation Registration", "Healthcare", ["organ donor"], ["identity", "address", "medical", "application", "photo"]),
  pack("Vaccination Certificate", "Healthcare", ["vaccine certificate"], ["identity", "vaccination", { key: "passport", required: false }]),
  pack("Medical Fitness Certificate", "Healthcare", ["fitness certificate"], ["identity", "medical", "photo", "application"]),

  pack("Tourist Visa", "Travel & Visa", ["travel visa"], ["passport", "photo", "bank", "income", "insurance", { key: "employment", required: false }]),
  pack("Student Visa", "Travel & Visa", ["study visa"], ["passport", "photo", "academic", "bank", "income", "bonafide"], "Student visa pack with passport, admission/academic proof, funding documents, and photographs."),
  pack("Work Visa", "Travel & Visa", ["employment visa"], ["passport", "photo", "employment", "academic", "bank", "police"]),
  pack("Business Visa", "Travel & Visa", ["business travel visa"], ["passport", "photo", "business", "bank", "itr", "gst"]),
  pack("Schengen Visa", "Travel & Visa", ["europe visa", "germany tourist visa", "germany visitor visa", "schengen tourist visa"], ["passport", "photo", "bank", "income", "insurance", "employment"], undefined, { searchMetadata: { destination: "Germany", intent: "tourist travel", purpose: "tourism", subject: "visitor visa", searchPhrases: ["going to germany for vacation", "visit germany for holiday", "travel to germany as a tourist"] } }),
  pack("US Visa", "Travel & Visa", ["usa visa", "b1 b2 visa"], ["passport", "photo", "bank", "income", "employment", { key: "academic", required: false }]),
  pack("UK Visa", "Travel & Visa", ["britain visa"], ["passport", "photo", "bank", "income", "employment", { key: "insurance", required: false }]),
  pack("Canada visa", "Travel & Visa", ["canadian visa", "visitor visa"], ["passport", "photo", "bank", "income", "employment", "academic"], undefined, {
    subtitle: "Visitor visa",
    sourceType: "curated",
    sourceName: "IRCC",
    sourceTitle: "IRCC visitor visa document checklist",
    sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html",
    lastCheckedAt: new Date("2026-07-25T00:00:00.000Z"),
    verificationSources: [{
      title: "IRCC visitor visa document checklist",
      organization: "Immigration, Refugees and Citizenship Canada (IRCC)",
      url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html",
      type: "government",
      retrievedAt: "2026-07-25T00:00:00.000Z",
    }],
    lastVerifiedAt: new Date("2026-07-25T00:00:00.000Z"),
    verificationStatus: "verified",
  }),
  pack("Australia Visa", "Travel & Visa", ["australian visa"], ["passport", "photo", "bank", "income", "insurance", { key: "employment", required: false }]),
  pack("International Driving Permit", "Travel & Visa", ["idp", "international dl"], ["passport", "drivingLicence", "identity", "address", "photo"]),
  pack("Travel Insurance", "Travel & Visa", ["travel cover", "overseas insurance"], ["identity", "passport", "insurance", { key: "medical", required: false }]),

  pack("College Admission", "Education", ["college application"], ["identity", "address", "photo", "marksheet", "transfer", { key: "migration", required: false }], "College admission readiness for identity, academic, transfer, and migration records."),
  pack("University Admission", "Education", ["university application"], ["identity", "address", "photo", "marksheet", "degree", "migration"]),
  pack("Scholarship Application", "Education", ["scholarship"], ["identity", "address", "academic", "income", "bank", "bonafide"]),
  pack("Student Loan", "Education", ["education finance"], ["identity", "pan", "address", "academic", "income", "bank"]),
  pack("Transcript Request", "Education", ["official transcript"], ["identity", "degree", "marksheet", "application"]),
  pack("Degree Verification", "Education", ["verify degree"], ["identity", "degree", "marksheet", { key: "transcript", required: false }]),
  pack("Convocation Certificate", "Education", ["convocation"], ["identity", "degree", "marksheet", "application"]),
  pack("Migration Certificate", "Education", ["migration request"], ["identity", "degree", "marksheet", "migration"]),

  pack("New Job Joining", "Employment", ["job joining", "joining formalities"], ["identity", "pan", "address", "bank", "cancelledCheque", "academic", "employment"], "New-job joining checklist with KYC, bank details, education proof, and employment paperwork."),
  pack("Background Verification", "Employment", ["bgv", "employee verification"], ["identity", "address", "academic", "employment", "experience", { key: "police", required: false }]),
  pack("PF Transfer", "Employment", ["epf transfer"], ["identity", "pan", "pf", "employment", "bank"]),
  pack("Gratuity Claim", "Employment", ["claim gratuity"], ["identity", "employment", "experience", "bank", "cancelledCheque"]),
  pack("Experience Certificate", "Employment", ["service certificate"], ["identity", "employment", "relieving", { key: "experience", required: false }]),
  pack("Resignation Process", "Employment", ["quit job", "exit formalities"], ["identity", "employment", "relieving", "pf", { key: "bank", required: false }]),
  pack("Employment Visa", "Employment", ["job visa"], ["passport", "employment", "academic", "police", "medical", "photo"]),
  pack("Overseas Employment", "Employment", ["work abroad"], ["passport", "employment", "academic", "police", "medical", "bank"]),

  pack("Property Purchase", "Property", ["buy property"], [
    { key: "aadhaar", title: "Buyer Aadhaar Card", group: "Buyer Identity" },
    { key: "pan", title: "Buyer PAN Card", group: "Buyer Identity" },
    { key: "aadhaar", owner: "seller", title: "Seller Aadhaar Card", group: "Seller Identity" },
    { key: "pan", owner: "seller", title: "Seller PAN Card", group: "Seller Identity" },
    { key: "propertyDeed", owner: "seller" },
    { key: "encumbrance", owner: "seller" },
    { key: "propertyTax", owner: "seller" },
    "bank",
  ]),
  pack("Property Sale", "Property", ["sell property"], ["identity", "pan", "address", "propertyDeed", "propertyTax", "bank"]),
  pack("Rental Agreement", "Property", ["rent agreement"], ["identity", "address", "rental", "photo", { key: "police", required: false }]),
  pack("Tenant Verification", "Property", ["police tenant verification"], ["identity", "address", "rental", "photo", "police"]),
  pack("Encumbrance Certificate", "Property", ["ec certificate"], ["identity", "propertyDeed", "encumbrance", "application"]),
  pack("Property Tax", "Property", ["pay property tax"], ["identity", "propertyDeed", "propertyTax", { key: "utility", required: false }]),

  pack("Child Birth Registration", "Family", ["newborn registration"], ["application", "identity", "hospitalBill", "relationship", "address"]),
  pack("School Admission", "Family", ["school application"], ["birth", "identity", "address", "photo", "vaccination", { key: "transfer", required: false }]),
  pack("Adoption Process", "Family", ["adopt child"], ["identity", "address", "income", "medical", "police", "affidavit"]),
  pack("Marriage Registration", "Family", ["register marriage"], ["identity", "address", "photo", "marriage", "affidavit"]),
  pack("Divorce Filing", "Family", ["file divorce"], ["identity", "address", "marriage", "bank", "affidavit"]),
  pack("Nominee Update", "Family", ["update nominee"], ["identity", "relationship", "bank", "insurance", { key: "marriage", required: false }]),
  pack("Legacy Planning", "Family", ["estate planning", "documents after death", "bereavement documents"], ["identity", "death", "relationship", "bank", "insurance", { key: "propertyDeed", required: false }], "A practical family checklist for organizing identity, relationship, financial, insurance, and property records after a death."),

  pack("LPG Connection", "Utilities", ["gas connection"], ["identity", "address", "bank", "photo"]),
  pack("Electricity Connection", "Utilities", ["power connection"], ["identity", "address", "propertyDeed", { key: "rental", required: false }]),
  pack("Water Connection", "Utilities", ["water supply connection"], ["identity", "address", "propertyDeed", { key: "propertyTax", required: false }]),
  pack("Broadband Connection", "Utilities", ["internet connection"], ["identity", "address", "photo", { key: "rental", required: false }]),
  pack("Mobile SIM KYC", "Utilities", ["sim card", "mobile kyc"], ["identity", "address", "photo"]),

  pack("Lost Passport", "Emergency", ["passport lost", "lost passport reissue"], ["identity", "address", "police", "photo", { key: "passport", required: false }]),
  pack("Lost PAN Card", "Emergency", ["pan lost", "duplicate pan"], ["identity", "address", "police", "photo", { key: "pan", required: false }]),
  pack("Lost Aadhaar", "Emergency", ["aadhaar lost", "duplicate aadhaar"], ["identity", "address", { key: "police", required: false }]),
  pack("Lost Driving Licence", "Emergency", ["dl lost", "duplicate driving licence"], ["identity", "address", "police", "photo", { key: "drivingLicence", required: false }]),
  pack("Disaster Relief Assistance", "Emergency", ["relief assistance", "flood relief"], ["identity", "address", "bank", "income", "affidavit", { key: "propertyDeed", required: false }]),
];

if (readinessPackSeeds.length !== 102) {
  throw new Error(`Expected 102 readiness packs, found ${readinessPackSeeds.length}`);
}
