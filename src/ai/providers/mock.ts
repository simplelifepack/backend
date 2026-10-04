import type { AIReadinessPackage } from "../intentTypes";
import type { AIProvider } from "./types";

export class MockAIProvider implements AIProvider {
  readonly name = "MockAIProvider";
  readonly model = "deterministic-mock";

  async analyzeIntent(query: string): Promise<AIReadinessPackage> {
    return packageResult(toTitle(query), "general", [
      ["identity_proof", "Identity", "identity_proof", "self", "Identity Proof"],
      ["address_proof", "Address", "address_proof", "self", "Address Proof"],
    ]);
  }
}

function packageResult(packageName: string, category: string, documents: Array<[string, string, string, AIReadinessPackage["requiredDocuments"][number]["owner"], string]>): AIReadinessPackage {
  const checkedAt = new Date().toISOString();
  return {
    packageName,
    category,
    description: `${packageName} readiness pack`,
    searchMetadata: { intent: category, subject: packageName, searchPhrases: [packageName] },
    sourceTitle: "Ministry of Electronics and Information Technology citizen services",
    sourceUrl: "https://www.meity.gov.in/",
    sourceOrganization: "Ministry of Electronics and Information Technology",
    lastChecked: checkedAt,
    verificationSources: [{
      title: "Ministry of Electronics and Information Technology citizen services",
      organization: "Ministry of Electronics and Information Technology",
      url: "https://www.meity.gov.in/",
      type: "government",
      retrievedAt: checkedAt,
    }],
    lastVerifiedAt: checkedAt,
    verificationStatus: "verified",
    requiredDocuments: documents.map(([id, documentCategory, documentType, owner, title]) => ({
      id, category: documentCategory, documentType, owner, name: title, title, required: true,
      whyNeeded: `${title} is listed by the official source for this package.`,
      sourceName: "Ministry of Electronics and Information Technology",
      sourceUrl: "https://www.meity.gov.in/", sourceAuthorityTier: "government",
      lastVerifiedAt: checkedAt,
    })),
  };
}

function toTitle(value: string) {
  return value.trim().split(/\s+/).slice(0, 8).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ") || "Custom Readiness";
}
