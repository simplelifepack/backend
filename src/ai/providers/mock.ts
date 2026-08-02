import type { AIReadinessPackage } from "../intentTypes";
import type { AIProvider } from "./types";

export class MockAIProvider implements AIProvider {
  readonly name = "MockAIProvider";
  readonly model = "deterministic-mock";

  async analyzeIntent(query: string): Promise<AIReadinessPackage> {
    const normalized = query.toLowerCase();
    if (/agricultur|farm land/.test(normalized)) {
      return packageResult("Telangana Agricultural Land Purchase", "property", [
        ["buyer_aadhaar", "Buyer Identity", "aadhaar", "self", "Buyer Aadhaar Card"],
        ["buyer_pan", "Buyer Identity", "pan", "self", "Buyer PAN Card"],
        ["seller_aadhaar", "Seller Identity", "aadhaar", "seller", "Seller Aadhaar Card"],
        ["seller_pan", "Seller Identity", "pan", "seller", "Seller PAN Card"],
        ["title_deed", "Property", "sale_deed", "seller", "Title Deed"],
        ["encumbrance_certificate", "Property", "encumbrance_certificate", "seller", "Encumbrance Certificate"],
        ["pattadar_passbook", "Property", "pattadar_passbook", "seller", "Pattadar Passbook"],
        ["revenue_records", "Property", "revenue_records", "seller", "Revenue Records"],
        ["survey_sketch", "Property", "survey_sketch", "seller", "Survey Sketch"],
        ["proof_of_funds", "Payment", "proof_of_funds", "self", "Proof of Funds"],
        ["registration_receipt", "Registration", "registration_receipt", "self", "Registration Receipt"],
      ]);
    }
    if (/germany|schengen/.test(normalized)) {
      return packageResult("Schengen Visa", "travel", [
        ["passport", "Identity", "passport", "self", "Passport"],
        ["bank_statement", "Finance", "bank_statement", "self", "Bank Statement"],
        ["travel_insurance", "Travel", "insurance_policy", "self", "Travel Insurance"],
      ]);
    }
    if (/father|mother|parent|passed away|died|death/.test(normalized)) {
      return packageResult("Legacy Planning", "legal", [
        ["death_certificate", "Identity", "death_certificate", "father", "Father Death Certificate"],
        ["relationship_proof", "Family", "identity_proof", "self", "Relationship Proof"],
        ["bank_statement", "Finance", "bank_statement", "father", "Father Bank Statement"],
      ]);
    }
    return packageResult(toTitle(query), "general", [
      ["identity_proof", "Identity", "identity_proof", "self", "Identity Proof"],
      ["address_proof", "Address", "address_proof", "self", "Address Proof"],
    ]);
  }
}

function packageResult(packageName: string, category: string, documents: Array<[string, string, string, AIReadinessPackage["requiredDocuments"][number]["owner"], string]>): AIReadinessPackage {
  return {
    packageName,
    category,
    description: `${packageName} readiness pack`,
    requiredDocuments: documents.map(([id, documentCategory, documentType, owner, title]) => ({ id, category: documentCategory, documentType, owner, name: title, title, required: true })),
  };
}

function toTitle(value: string) {
  return value.trim().split(/\s+/).slice(0, 8).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ") || "Custom Readiness";
}
