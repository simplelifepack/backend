import fs from "fs";
import path from "path";
import vm from "vm";
import ts from "typescript";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { normalizeRequirementDocumentTypes, slugify } from "../services/readiness/normalization";


export type EventPackage = {
  id: string;
  name: string;
  blurb: string;
  cat: string;
  reqs: string[];
  conditional?: string[];
  accent: string;
  icon: string;
  source: string;
  lastChecked: string;
};


export type DefaultPackageRecord = {
  slug: string;
  id: string;
  title: string;
  subtitle: string;
  category: string;
  description: string;
  searchMetadata: Prisma.InputJsonObject;
  sourceName: string | null;
  sourceTitle: string | null;
  lastCheckedAt: Date | null;
  verificationSources: Prisma.InputJsonArray;
};


export type DefaultRequirementRecord = {
  acceptedDocumentTypes: string[];
  alternativeLabels: string[];
  description: string;
  documentType: string;
  group: string;
  id: string;
  metadata: Prisma.InputJsonObject;
  owner: string;
  required: boolean;
  slug: string;
  sortOrder: number;
  title: string;
};


export const DEFAULT_LAST_CHECKED = "Jul 25, 2026";

export const REFERENCE_SOURCE = "App.tsx EVENTS";

export const REQUIRED_DEFAULT_PACKAGE_NAMES = [
  "Schengen visa",
  "UK visa",
  "Canada visa",
  "Australia visitor visa",
  "Japan tourist visa",
  "Singapore visa",
  "UAE visit visa",
  "Travel insurance purchase",
  "International driving permit",
  "Lost passport reissue",
  "Lost driving licence duplicate",
  "Mobile SIM KYC",
  "New passport",
  "Passport renewal",
  "Passport for a minor",
  "Driving license",
  "Driving license renewal",
  "Vehicle registration",
  "Vehicle ownership transfer",
  "Police clearance certificate",
  "Legal name change",
  "Car loan",
  "Personal loan",
  "Education loan",
  "Credit card application",
  "Bank account opening",
  "Loan closure and lien release",
  "Background verification",
  "New job onboarding",
  "Freelance client KYC",
  "Resignation and relieving",
  "School admission",
  "College admission",
  "Postgraduate admission",
  "Study abroad application",
  "Competitive exam application",
  "Scholarship application",
  "School transfer",
  "Degree attestation",
  "Duplicate marksheet reissue",
  "Hospital admission",
  "Health insurance reimbursement",
  "Cashless pre-authorization",
  "New health insurance",
  "Maternity hospital pack",
  "Vaccination record pack",
  "Employer medical reimbursement",
  "Home loan",
  "Property sale",
  "Property purchase",
  "Renting a home",
  "Renting out property",
  "New electricity connection",
  "Home insurance purchase",
  "Marriage registration",
  "Death certificate application",
  "Adoption process",
  "Newborn documentation",
  "Add family member to insurance",
  "Will preparation",
  "Nominee updates",
  "Life insurance claim",
  "Settlements after a death",
  "Pension application",
  "Family pension claim",
] as const;

export const ICON_NAMES = [
  "Baby",
  "BookUser",
  "Briefcase",
  "Car",
  "FileText",
  "Gem",
  "GraduationCap",
  "HeartPulse",
  "HomeIcon",
  "IdCard",
  "Landmark",
  "Plane",
  "Shield",
  "ShieldCheck",
  "Users",
  "Wallet",
];
