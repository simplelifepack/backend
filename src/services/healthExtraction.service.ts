import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import { z } from "zod";

const documentTypes = ["lab_report", "medical_report", "prescription"] as const;

const extractionSchema = z.object({
  documentType: z.enum(documentTypes),
  patient: z.object({
    name: z.string().nullable().optional(),
    dateOfBirth: z.string().nullable().optional(),
    age: z.number().nullable().optional(),
    gender: z.string().nullable().optional(),
  }).nullable().optional(),
  documentDate: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  doctor: z.string().nullable().optional(),
  measurements: z.array(z.object({
    name: z.string(),
    metricKey: z.string().nullable().optional(),
    value: z.number(),
    secondaryValue: z.number().nullable().optional(),
    unit: z.string(),
    referenceMin: z.number().nullable().optional(),
    referenceMax: z.number().nullable().optional(),
    referenceText: z.string().nullable().optional(),
    context: z.string().nullable().optional(),
    bodySite: z.string().nullable().optional(),
  })).default([]),
  medications: z.array(z.object({
    name: z.string(),
    dose: z.string().nullable().optional(),
    frequency: z.string().nullable().optional(),
    duration: z.string().nullable().optional(),
    quantity: z.string().nullable().optional(),
  })).default([]),
  followUps: z.array(z.object({
    title: z.string(),
    explicitDate: z.string().nullable().optional(),
    recommendedAfter: z.object({
      value: z.number(),
      unit: z.enum(["days", "weeks", "months", "years"]),
    }).nullable().optional(),
    sourceText: z.string().nullable().optional(),
  })).default([]),
}).strict();

export type HealthExtraction = z.infer<typeof extractionSchema>;
export type HealthDocumentType = HealthExtraction["documentType"];

const prompt = `Extract structured health information from the supplied Readiness document text.

Return JSON only. Do not diagnose, infer conditions, create health scores, choose tracked metrics, invent follow-ups, assign ownership, or calculate reminders.

Only extract facts explicitly present in the document.

For lab reports: patient identity when explicitly present, documentDate, provider, doctor, measurements with actual values and source reference ranges, explicit followUps.
For medical reports: documentDate, provider, doctor, explicitly written diagnoses/procedures if visible in sourceText follow-up text only, measurements, explicit followUps.
For prescriptions: documentDate, provider, doctor, medications, explicit refill/follow-up instructions. Do not infer refill dates from quantity and frequency.
`;

function parseJsonObject(input: string) {
  try {
    return JSON.parse(input);
  } catch {
    const match = input.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function fallbackHealthExtraction(type: HealthDocumentType): HealthExtraction {
  return { documentType: type, patient: null, measurements: [], medications: [], followUps: [] };
}

export async function extractHealthDocument(input: {
  type: HealthDocumentType;
  text: string;
  file: { bytes: Buffer; mimeType: string; name: string };
}) {
  if (!input.file.bytes.length || !process.env.OPENAI_API_KEY) {
    throw new Error("The stored health document could not be sent for extraction.");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const encoded = input.file.bytes.toString("base64");
  const documentContent: ResponseInputContent = input.file.mimeType.startsWith("image/")
    ? { type: "input_image", image_url: `data:${input.file.mimeType};base64,${encoded}`, detail: "high" }
    : { type: "input_file", filename: input.file.name, file_data: `data:${input.file.mimeType};base64,${encoded}` };
  const response = await client.responses.create({
    store: false,
    model: process.env.OPENAI_HEALTH_EXTRACTION_MODEL ?? process.env.OPENAI_ICR_MODEL ?? "gpt-5-mini",
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        { type: "input_text", text: `Expected documentType: ${input.type}. Extract only values visible in the attached original document.${input.text.trim() ? `\n\nOCR text (supporting context only):\n${input.text.slice(0, 24_000)}` : ""}` },
        documentContent,
      ],
    }],
    text: {
      format: {
        type: "json_schema",
        name: "readiness_health_extraction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            documentType: { type: "string", enum: documentTypes },
            patient: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: { name: { type: ["string", "null"] }, dateOfBirth: { type: ["string", "null"] }, age: { type: ["number", "null"] }, gender: { type: ["string", "null"] } }, required: ["name", "dateOfBirth", "age", "gender"] }] },
            documentDate: { type: ["string", "null"] },
            provider: { type: ["string", "null"] },
            doctor: { type: ["string", "null"] },
            measurements: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, metricKey: { type: ["string", "null"] }, value: { type: "number" }, secondaryValue: { type: ["number", "null"] }, unit: { type: "string" }, referenceMin: { type: ["number", "null"] }, referenceMax: { type: ["number", "null"] }, referenceText: { type: ["string", "null"] }, context: { type: ["string", "null"] }, bodySite: { type: ["string", "null"] } }, required: ["name", "metricKey", "value", "secondaryValue", "unit", "referenceMin", "referenceMax", "referenceText", "context", "bodySite"] } },
            medications: { type: "array", items: { type: "object", additionalProperties: false, properties: { name: { type: "string" }, dose: { type: ["string", "null"] }, frequency: { type: ["string", "null"] }, duration: { type: ["string", "null"] }, quantity: { type: ["string", "null"] } }, required: ["name", "dose", "frequency", "duration", "quantity"] } },
            followUps: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, explicitDate: { type: ["string", "null"] }, recommendedAfter: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: { value: { type: "number" }, unit: { type: "string", enum: ["days", "weeks", "months", "years"] } }, required: ["value", "unit"] }] }, sourceText: { type: ["string", "null"] } }, required: ["title", "explicitDate", "recommendedAfter", "sourceText"] } },
          },
          required: ["documentType", "patient", "documentDate", "provider", "doctor", "measurements", "medications", "followUps"],
        },
      },
    },
  });
  return extractionSchema.parse(parseJsonObject(response.output_text));
}

export { extractionSchema };
