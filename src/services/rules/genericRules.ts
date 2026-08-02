import {
  createRule,
  extractAccountMasked,
  extractDate,
  extractIfsc,
  extractMoney,
  extractNameNearLabel,
  extractPanNumber,
} from "./helpers";
import type { DocumentRule, WeightedSignal } from "./types";

const signal = (
  label: string,
  pattern: RegExp,
  points: number,
  strong = false,
): WeightedSignal => ({
  label,
  pattern,
  points,
  strong,
});

type GenericRuleInput = [string, string, Array<[string, number]>];

const genericRuleInputs: GenericRuleInput[] = [
  ["birth_certificate", "identity", [["birth certificate", 50], ["date of birth", 15], ["place of birth", 15], ["name of father", 15], ["name of mother", 15], ["registrar of births", 25]]],
  ["marriage_certificate", "identity", [["marriage certificate", 55], ["bride", 15], ["groom", 15], ["date of marriage", 20], ["registrar of marriages", 25]]],
  ["death_certificate", "identity", [["death certificate", 55], ["date of death", 25], ["cause of death", 20], ["registrar of births and deaths", 25]]],
  ["payslip", "employment", [["salary slip", 45], ["payslip", 45], ["gross salary", 20], ["net pay", 20], ["earnings", 15], ["deductions", 15], ["basic salary", 15], ["hra", 10], ["provident fund", 10], ["\\bpf\\b", 10]]],
  ["offer_letter", "employment", [["offer letter", 50], ["we are pleased to offer", 35], ["position", 10], ["date of joining", 15], ["ctc", 15]]],
  ["appointment_letter", "employment", [["appointment letter", 55], ["appointed as", 25], ["terms of employment", 15], ["probation", 10]]],
  ["experience_letter", "employment", [["experience letter", 55], ["worked with us", 30], ["employed from", 20], ["designation", 10]]],
  ["relieving_letter", "employment", [["relieving letter", 55], ["relieved from duties", 30], ["last working day", 25]]],
  ["employment_contract", "employment", [["employment contract", 50], ["terms and conditions of employment", 25], ["non disclosure", 10], ["confidentiality", 10]]],
  ["employee_id", "employment", [["employee id", 40], ["employee code", 35], ["designation", 10], ["department", 10]]],
  ["bank_statement", "finance", [["bank statement", 50], ["account statement", 45], ["account number", 20], ["ifsc", 20], ["opening balance", 20], ["closing balance", 20], ["transaction date", 15]]],
  ["passbook", "finance", [["passbook", 50], ["account holder", 20], ["branch", 10], ["ifsc", 20]]],
  ["form16", "finance", [["form 16", 60], ["certificate under section 203", 40], ["tax deducted at source", 25], ["tan of the deductor", 20], ["assessment year", 10]]],
  ["itr", "finance", [["income tax return", 40], ["itr acknowledgement", 55], ["acknowledgement number", 30], ["assessment year", 15], ["e-filing", 15]]],
  ["investment_statement", "finance", [["investment statement", 50], ["mutual fund", 20], ["folio", 20], ["nav", 15], ["units", 15]]],
  ["fixed_deposit", "finance", [["fixed deposit", 45], ["term deposit", 35], ["maturity amount", 25], ["maturity date", 20], ["interest rate", 15]]],
  ["loan_statement", "finance", [["loan statement", 50], ["loan account number", 30], ["emi", 20], ["principal outstanding", 25], ["interest paid", 15]]],
  ["credit_card_statement", "finance", [["credit card statement", 55], ["minimum amount due", 25], ["payment due date", 25], ["credit limit", 20], ["card ending", 15]]],
  ["prescription", "medical", [["prescription", 50], ["\\brx\\b", 25], ["dosage", 15], ["tablet", 10], ["capsule", 10], ["doctor", 10]]],
  ["lab_report", "medical", [["lab report", 50], ["pathology", 20], ["test name", 15], ["reference range", 25], ["sample collected", 15], ["hemoglobin", 10], ["hba1c", 15]]],
  ["medical_report", "medical", [["medical report", 50], ["diagnosis", 25], ["clinical history", 20], ["findings", 15], ["impression", 15]]],
  ["discharge_summary", "medical", [["discharge summary", 60], ["date of admission", 20], ["date of discharge", 20], ["hospital course", 15], ["advice on discharge", 15]]],
  ["vaccination_certificate", "medical", [["vaccination certificate", 55], ["vaccine", 20], ["dose", 15], ["beneficiary id", 20], ["cowin", 25]]],
  ["health_insurance", "insurance", [["health insurance", 45], ["policy schedule", 25], ["sum insured", 25], ["cashless", 15], ["tpa", 15], ["policy number", 15]]],
  ["health_insurance_card", "insurance", [["health card", 45], ["cashless card", 45], ["tpa id", 25], ["member id", 20]]],
  ["life_insurance", "insurance", [["life insurance", 50], ["life assured", 25], ["nominee", 20], ["death benefit", 25], ["premium payment term", 15]]],
  ["vehicle_insurance", "insurance", [["vehicle insurance", 45], ["motor insurance", 45], ["registration no", 20], ["engine no", 15], ["chassis no", 15], ["idv", 15]]],
  ["travel_insurance", "insurance", [["travel insurance", 55], ["schengen", 20], ["coverage area", 15], ["trip start date", 15], ["trip end date", 15]]],
  ["sale_deed", "property", [["sale deed", 60], ["vendor", 15], ["purchaser", 15], ["schedule property", 25], ["registration number", 15]]],
  ["gift_deed", "property", [["gift deed", 60], ["donor", 20], ["donee", 20], ["gifted property", 20]]],
  ["lease_agreement", "property", [["lease agreement", 55], ["lessor", 20], ["lessee", 20], ["lease term", 15]]],
  ["rental_agreement", "property", [["rental agreement", 55], ["landlord", 20], ["tenant", 20], ["monthly rent", 20], ["security deposit", 15]]],
  ["property_tax_receipt", "property", [["property tax receipt", 60], ["assessment number", 25], ["ward", 10], ["tax paid", 20]]],
  ["encumbrance_certificate", "property", [["encumbrance certificate", 60], ["ec number", 25], ["sub registrar", 20], ["period from", 10], ["period to", 10]]],
  ["khata_certificate", "property", [["khata certificate", 60], ["khata number", 30], ["bbmp", 20]]],
  ["occupancy_certificate", "property", [["occupancy certificate", 60], ["building plan", 15], ["completion certificate", 15], ["municipal corporation", 15]]],
  ["degree_certificate", "education", [["degree certificate", 50], ["bachelor of", 20], ["master of", 20], ["university", 15], ["convocation", 15]]],
  ["diploma", "education", [["diploma", 45], ["polytechnic", 15], ["board of technical education", 20]]],
  ["marks_memo", "education", [["marks memo", 45], ["marksheet", 45], ["statement of marks", 45], ["subject", 10], ["grade", 10], ["percentage", 10]]],
  ["transcript", "education", [["transcript", 55], ["semester", 15], ["credits", 15], ["grade point", 15]]],
  ["transfer_certificate", "education", [["transfer certificate", 55], ["tc no", 20], ["date of leaving", 20], ["conduct", 10]]],
  ["migration_certificate", "education", [["migration certificate", 55], ["migrated from", 20], ["university", 10]]],
  ["bonafide_certificate", "education", [["bonafide certificate", 55], ["is a bonafide student", 35], ["academic year", 10]]],
  ["flight_ticket", "travel", [["flight ticket", 45], ["e-ticket", 35], ["pnr", 25], ["flight number", 20], ["departure", 10], ["arrival", 10]]],
  ["boarding_pass", "travel", [["boarding pass", 55], ["gate", 15], ["seat", 15], ["boarding time", 20], ["sequence", 10]]],
  ["hotel_booking", "travel", [["hotel booking", 45], ["reservation", 20], ["check-in", 20], ["check-out", 20], ["guest name", 15]]],
  ["visa_approval", "travel", [["visa approval", 45], ["visa granted", 35], ["\\bvisa\\b", 25], ["valid from", 15], ["valid until", 15], ["entries", 10]]],
  ["travel_itinerary", "travel", [["travel itinerary", 45], ["itinerary", 25], ["day 1", 10], ["booking reference", 15]]],
  ["rc_book", "vehicle", [["registration certificate", 45], ["rc book", 45], ["vehicle registration", 35], ["registration no", 25], ["chassis no", 20], ["engine no", 20]]],
  ["puc_certificate", "vehicle", [["pollution under control", 55], ["puc certificate", 55], ["emission test", 25], ["valid upto", 15]]],
  ["affidavit", "legal", [["affidavit", 60], ["deponent", 25], ["sworn", 15], ["notary", 15]]],
  ["power_of_attorney", "legal", [["power of attorney", 60], ["principal", 20], ["attorney holder", 20], ["authorize", 10]]],
  ["court_order", "legal", [["court order", 55], ["hon'?ble court", 25], ["case no", 25], ["petitioner", 15], ["respondent", 15]]],
  ["legal_notice", "legal", [["legal notice", 60], ["advocate", 20], ["under instructions from my client", 20]]],
  ["will", "legal", [["last will and testament", 70], ["testator", 25], ["executor", 20], ["beneficiary", 20]]],
];

export const genericRules: DocumentRule[] = genericRuleInputs.map(
  ([documentType, category, rawSignals]) =>
    createRule({
      documentType,
      category: category as never,
      positives: rawSignals.map(([label, points]) =>
        signal(label, new RegExp(label, "i"), points, points >= 45),
      ),
      negatives:
        documentType === "bank_statement"
          ? [signal("credit card statement", /credit card statement/i, 30)]
          : documentType === "credit_card_statement"
            ? [signal("bank statement", /\bbank statement\b/i, 10)]
            : [],
      extractFields: (text) => ({
        name: extractNameNearLabel(text, [
          "name",
          "employee name",
          "patient name",
          "student name",
        ]),
        date: extractDate(text) ?? "",
        amount: extractMoney(text) ?? "",
        panNumber: extractPanNumber(text) ?? "",
        ifsc: extractIfsc(text) ?? "",
        accountNumberMasked: extractAccountMasked(text) ?? "",
      }),
    }),
);
