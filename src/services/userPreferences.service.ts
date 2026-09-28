import { prisma } from "../lib/prisma";

export const supportedCountries = [
  "AU", "CA", "CH", "DE", "FR", "GB", "IN", "JP", "SG", "US", "AE", "SA",
  "NZ", "IE", "NL", "IT", "ES", "SE", "NO", "DK", "FI", "MY", "TH", "ZA",
] as const;

export const supportedCurrencies = [
  "INR", "USD", "EUR", "GBP", "AED", "SGD", "CHF", "AUD", "CAD", "SAR", "JPY",
] as const;

const countryLabels: Record<string, string> = {
  AU: "Australia",
  CA: "Canada",
  CH: "Switzerland",
  DE: "Germany",
  FR: "France",
  GB: "United Kingdom",
  IN: "India",
  JP: "Japan",
  SG: "Singapore",
  US: "United States",
  AE: "United Arab Emirates",
  SA: "Saudi Arabia",
  NZ: "New Zealand",
  IE: "Ireland",
  NL: "Netherlands",
  IT: "Italy",
  ES: "Spain",
  SE: "Sweden",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  MY: "Malaysia",
  TH: "Thailand",
  ZA: "South Africa",
};

export type AppearancePreference = "dark" | "light";

export type UserPreferenceResponse = {
  country: string | null;
  passportCountry: string | null;
  homeCurrency: string | null;
  appearance: AppearancePreference;
  aiProcessingEnabled: boolean;
};

function optionalString(value: unknown) {
  if (value === null) return null;
  return typeof value === "string" ? value.trim().toUpperCase() : undefined;
}

function validateCode(value: unknown, allowed: readonly string[], label: string) {
  const code = optionalString(value);
  if (code === undefined) return undefined;
  if (code === null) return null;
  if (!allowed.includes(code)) {
    throw Object.assign(new Error(`${label} is not supported.`), { statusCode: 400 });
  }
  return code;
}

function validateAppearance(value: unknown) {
  if (value === undefined) return undefined;
  if (value !== "dark" && value !== "light") {
    throw Object.assign(new Error("Appearance is not supported."), { statusCode: 400 });
  }
  return value;
}

function serialize(user: {
  appearance: string;
  aiProcessingEnabled: boolean;
  country: string | null;
  homeCurrency: string | null;
  passportCountry: string | null;
}): UserPreferenceResponse {
  return {
    country: user.country,
    passportCountry: user.passportCountry,
    homeCurrency: user.homeCurrency,
    appearance: user.appearance === "light" ? "light" : "dark",
    aiProcessingEnabled: user.aiProcessingEnabled,
  };
}

export async function getUserPreferences(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { country: true, passportCountry: true, homeCurrency: true, appearance: true, aiProcessingEnabled: true },
  });
  if (!user) throw Object.assign(new Error("Unauthorized."), { statusCode: 401 });
  return serialize(user);
}

export async function updateUserPreferences(userId: string, body: unknown) {
  const record = body as Record<string, unknown> | null;
  const data = {
    country: validateCode(record?.country, supportedCountries, "Country"),
    passportCountry: validateCode(record?.passportCountry, supportedCountries, "Passport country"),
    homeCurrency: validateCode(record?.homeCurrency, supportedCurrencies, "Home currency"),
    appearance: validateAppearance(record?.appearance),
    aiProcessingEnabled: typeof record?.aiProcessingEnabled === "boolean" ? record.aiProcessingEnabled : undefined,
  };
  const update = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  const user = await prisma.user.update({
    where: { id: userId },
    data: update,
    select: { country: true, passportCountry: true, homeCurrency: true, appearance: true, aiProcessingEnabled: true },
  });
  return serialize(user);
}

export function countryPreferenceLabel(country: string | null) {
  return country ? countryLabels[country] ?? country : null;
}
