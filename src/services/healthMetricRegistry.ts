const registry = [
  {
    metricKey: "fasting_glucose",
    displayName: "Fasting glucose",
    category: "glucose",
    aliases: ["fbs", "fasting sugar", "fasting blood sugar", "blood glucose fasting", "blood glucose - fasting", "glucose fasting"],
  },
  {
    metricKey: "ldl_cholesterol",
    displayName: "LDL cholesterol",
    category: "lipids",
    aliases: ["ldl", "ldl-c", "ldl cholesterol", "low density lipoprotein"],
  },
  {
    metricKey: "hba1c",
    displayName: "HbA1c",
    category: "glucose",
    aliases: ["a1c", "glycated hemoglobin", "glycosylated hemoglobin", "hb a1c"],
  },
  {
    metricKey: "vitamin_d",
    displayName: "Vitamin D",
    category: "vitamins",
    aliases: ["25-oh vitamin d", "vit d", "vitamin d total", "d3"],
  },
] as const;

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function customKey(value: string) {
  const key = normalize(value).replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return key || "unknown_measurement";
}

export function normalizeMetricName(name: string) {
  const normalized = normalize(name);
  const match = registry.find((item) =>
    normalize(item.displayName) === normalized ||
    item.aliases.some((alias) => normalize(alias) === normalized),
  );
  if (match) return { metricKey: match.metricKey, displayName: match.displayName, aliases: [...match.aliases], category: match.category };
  const displayName = name.trim().replace(/\s+/g, " ");
  return { metricKey: customKey(displayName), displayName, aliases: [] as string[], category: "custom" };
}

export function metricSearchTerms(metricKey: string, displayName: string) {
  const match = registry.find((item) => item.metricKey === metricKey);
  return [metricKey, displayName, ...(match?.aliases ?? [])].map(normalize);
}
