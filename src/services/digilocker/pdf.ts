function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function flatten(value: unknown, prefix = ""): Array<[string, string]> {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flatten(item, `${prefix}${prefix ? "." : ""}${index + 1}`));
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      flatten(item, `${prefix}${prefix ? "." : ""}${key}`),
    );
  }
  return [[prefix || "value", String(value)]];
}

export function renderDigiLockerDocumentPdf(input: {
  documentType: string;
  verificationId: string;
  referenceId: string | null;
  payload: unknown;
}) {
  const rows = flatten(input.payload)
    .filter(([key]) => !/photo|image|base64|xml|file/i.test(key))
    .slice(0, 80);
  const lines = [
    "Readiness DigiLocker Import",
    `Document type: ${input.documentType}`,
    `Verification ID: ${input.verificationId}`,
    ...(input.referenceId ? [`Reference ID: ${input.referenceId}`] : []),
    `Imported at: ${new Date().toISOString()}`,
    "",
    ...rows.map(([key, value]) => `${key}: ${value}`),
  ];
  const text = lines.map((line, index) => `BT /F1 10 Tf 50 ${780 - index * 14} Td (${escapePdfText(line.slice(0, 110))}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text, "latin1")} >>\nstream\n${text}\nendstream`,
  ];
  const parts = ["%PDF-1.4\n"];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(parts.join(""), "latin1"));
    parts.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
  }
  const xrefOffset = Buffer.byteLength(parts.join(""), "latin1");
  parts.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let index = 1; index < offsets.length; index += 1) {
    parts.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  }
  parts.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
  return Buffer.from(parts.join(""), "latin1");
}
