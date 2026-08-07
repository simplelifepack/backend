import type { SeedReadinessPack, VerificationSource } from "./readinessPackData";

type SeedSource = Omit<VerificationSource, "retrievedAt" | "type"> & {
  type?: VerificationSource["type"];
};

const checkedAt = new Date("2026-08-06T00:00:00.000Z");

const exactSources: Record<string, SeedSource> = {
  "Aadhaar Card": { title: "UIDAI Aadhaar enrolment and update", organization: "Unique Identification Authority of India", url: "https://uidai.gov.in/", type: "government" },
  "Lost Aadhaar": { title: "UIDAI Aadhaar services", organization: "Unique Identification Authority of India", url: "https://uidai.gov.in/", type: "government" },
  "PAN Card": { title: "Income Tax Department PAN services", organization: "Income Tax Department, Government of India", url: "https://www.incometax.gov.in/", type: "government" },
  "Lost PAN Card": { title: "Income Tax Department PAN services", organization: "Income Tax Department, Government of India", url: "https://www.incometax.gov.in/", type: "government" },
  "Passport Application Pack": { title: "Passport Seva documents required", organization: "Ministry of External Affairs, Government of India", url: "https://passportindia.gov.in/AppOnlineProject/docAdvisor/attachmentAdvisorInp", type: "government" },
  "Passport Renewal": { title: "Passport Seva documents required", organization: "Ministry of External Affairs, Government of India", url: "https://passportindia.gov.in/AppOnlineProject/docAdvisor/attachmentAdvisorInp", type: "government" },
  "Lost Passport": { title: "Passport Seva documents required", organization: "Ministry of External Affairs, Government of India", url: "https://passportindia.gov.in/AppOnlineProject/docAdvisor/attachmentAdvisorInp", type: "government" },
  "Driving Licence New": { title: "Parivahan driving licence services", organization: "Ministry of Road Transport and Highways", url: "https://parivahan.gov.in/parivahan/", type: "government" },
  "Driving Licence Renewal": { title: "Parivahan driving licence services", organization: "Ministry of Road Transport and Highways", url: "https://parivahan.gov.in/parivahan/", type: "government" },
  "Lost Driving Licence": { title: "Parivahan driving licence services", organization: "Ministry of Road Transport and Highways", url: "https://parivahan.gov.in/parivahan/", type: "government" },
  "Voter ID": { title: "Election Commission voter services", organization: "Election Commission of India", url: "https://voters.eci.gov.in/", type: "government" },
  "US Visa": { title: "U.S. Visas visitor visa documents", organization: "U.S. Department of State", url: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html", type: "government" },
  "UK Visa": { title: "UK Standard Visitor visa documents", organization: "UK Visas and Immigration", url: "https://www.gov.uk/standard-visitor", type: "government" },
  "Australia Visa": { title: "Visitor visa documents", organization: "Department of Home Affairs, Australian Government", url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600", type: "government" },
  "Schengen Visa": { title: "VFS Global Schengen visa document guidance", organization: "VFS Global", url: "https://visa.vfsglobal.com/", type: "official" },
  "International Driving Permit": { title: "Parivahan international driving permit services", organization: "Ministry of Road Transport and Highways", url: "https://parivahan.gov.in/parivahan/", type: "government" },
  "Income Tax Filing": { title: "Income Tax Department e-Filing", organization: "Income Tax Department, Government of India", url: "https://www.incometax.gov.in/", type: "government" },
  "GST Registration": { title: "GST registration", organization: "Goods and Services Tax", url: "https://www.gst.gov.in/", type: "government" },
  "GST Return Filing": { title: "GST returns", organization: "Goods and Services Tax", url: "https://www.gst.gov.in/", type: "government" },
  "Business Registration": { title: "MCA services", organization: "Ministry of Corporate Affairs", url: "https://www.mca.gov.in/content/mca/global/en/home.html", type: "government" },
  "LLP Registration": { title: "MCA LLP services", organization: "Ministry of Corporate Affairs", url: "https://www.mca.gov.in/content/mca/global/en/home.html", type: "government" },
  "Private Limited Company": { title: "MCA company services", organization: "Ministry of Corporate Affairs", url: "https://www.mca.gov.in/content/mca/global/en/home.html", type: "government" },
  "Trademark Registration": { title: "IP India trademark registry", organization: "Controller General of Patents, Designs and Trade Marks", url: "https://ipindia.gov.in/trade-marks.htm", type: "government" },
  "Japan - Personal Readiness Starter Pack": { title: "Residence card and My Number Card information", organization: "Immigration Services Agency of Japan", url: "https://www.moj.go.jp/isa/applications/procedures/whatzairyu_00001.html", type: "government" },
  "Japan Home Loan Readiness": { title: "Home loan required documents", organization: "MUFG Bank", url: "https://www.bk.mufg.jp/kariru/jutaku/soudan/shorui_form/index.html", type: "bank" },
  "Nepal Tourist Visa Application": { title: "Nepal tourist visa information", organization: "Department of Immigration, Nepal", url: "https://immigration.gov.np/visa-information", type: "government" },
  "Japan Visit Visa (Short-Term Stay) Readiness Package": { title: "Visa short-term visit required documents", organization: "Embassy of Japan in the United States of America", url: "https://www.us.emb-japan.go.jp/itpr_en/visa-short-term-visit.html", type: "government" },
  "Japan Work Visa Application": { title: "Working visa skilled labor necessary documents", organization: "Ministry of Foreign Affairs of Japan", url: "https://www.mofa.go.jp/j_info/visit/visa/long/visa4.html", type: "government" },
  "Oxford University — Undergraduate application (UCAS)": { title: "UCAS application", organization: "University of Oxford", url: "https://www.ox.ac.uk/admissions/undergraduate/applying/guide-for-applicants/ucas-application", type: "university" },
};

const categorySources: Record<string, SeedSource> = {
  "Identity & Government": { title: "National Portal of India citizen services", organization: "Government of India", url: "https://www.india.gov.in/topics/services", type: "government" },
  "Banking & Finance": { title: "RBI KYC master direction", organization: "Reserve Bank of India", url: "https://www.rbi.org.in/Scripts/BS_ViewMasDirections.aspx?id=11566", type: "authority" },
  "Tax & Legal": { title: "National Portal of India law and justice services", organization: "Government of India", url: "https://www.india.gov.in/topics/law-justice", type: "government" },
  Healthcare: { title: "Ministry of Health and Family Welfare", organization: "Ministry of Health and Family Welfare", url: "https://www.mohfw.gov.in/", type: "government" },
  "Travel & Visa": { title: "Consular, Passport and Visa services", organization: "Ministry of External Affairs, Government of India", url: "https://www.mea.gov.in/consular-passport-visa.htm", type: "government" },
  Education: { title: "Ministry of Education", organization: "Ministry of Education, Government of India", url: "https://www.education.gov.in/", type: "government" },
  Employment: { title: "EPFO services", organization: "Employees' Provident Fund Organisation", url: "https://www.epfindia.gov.in/", type: "government" },
  Property: { title: "Registration and Stamps Department Telangana", organization: "Registration and Stamps Department Telangana", url: "https://registration.telangana.gov.in/", type: "government" },
  Family: { title: "National Portal of India family services", organization: "Government of India", url: "https://www.india.gov.in/topics/services", type: "government" },
  Utilities: { title: "National Portal of India utility services", organization: "Government of India", url: "https://www.india.gov.in/topics/services", type: "government" },
  Emergency: { title: "National Disaster Management Authority", organization: "National Disaster Management Authority", url: "https://ndma.gov.in/", type: "government" },
};

export function sourceMetadataForSeed(title: string, category: string): Partial<Pick<SeedReadinessPack, "lastCheckedAt" | "lastVerifiedAt" | "sourceName" | "sourceTitle" | "sourceType" | "sourceUrl" | "verificationSources" | "verificationStatus">> {
  const selected = exactSources[title] ?? categorySources[category] ?? categorySources["Identity & Government"];
  return sourceMetadata(selected);
}

export function sourceMetadataForExactPackage(title: string): Partial<Pick<SeedReadinessPack, "lastCheckedAt" | "lastVerifiedAt" | "sourceName" | "sourceTitle" | "sourceType" | "sourceUrl" | "verificationSources" | "verificationStatus">> | null {
  const selected = exactSources[title];
  return selected ? sourceMetadata(selected) : null;
}

function sourceMetadata(selected: SeedSource): Partial<Pick<SeedReadinessPack, "lastCheckedAt" | "lastVerifiedAt" | "sourceName" | "sourceTitle" | "sourceType" | "sourceUrl" | "verificationSources" | "verificationStatus">> {
  const retrievedAt = checkedAt.toISOString();
  return {
    sourceType: selected.type ?? "government",
    sourceName: selected.organization,
    sourceTitle: selected.title,
    sourceUrl: selected.url,
    lastCheckedAt: checkedAt,
    verificationSources: [{ ...selected, type: selected.type ?? "government", retrievedAt }],
    lastVerifiedAt: checkedAt,
    verificationStatus: "verified",
  };
}
