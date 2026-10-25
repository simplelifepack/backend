export const documentTypes = ["lab_report", "medical_report", "prescription"] as const;
export const prescriptionOutcomes = ["not_prescription", "medications_detected", "partial_medications_detected", "handwriting_unreadable", "no_medications_detected"] as const;
// Exact provider response shape; kept separate from extraction execution.
export const healthExtractionResponseSchema = {
          type: "object",
          additionalProperties: false,
          properties: {
            documentType: { type: "string", enum: documentTypes },
            patient: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: ["string", "null"] },
                    dateOfBirth: { type: ["string", "null"] },
                    age: { type: ["number", "null"] },
                    gender: { type: ["string", "null"] },
                  },
                  required: ["name", "dateOfBirth", "age", "gender"],
                },
              ],
            },
            documentDate: { type: ["string", "null"] },
            provider: { type: ["string", "null"] },
            doctor: { type: ["string", "null"] },
            measurements: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  metricKey: { type: ["string", "null"] },
                  value: { type: "number" },
                  secondaryValue: { type: ["number", "null"] },
                  unit: { type: "string" },
                  referenceMin: { type: ["number", "null"] },
                  referenceMax: { type: ["number", "null"] },
                  referenceText: { type: ["string", "null"] },
                  context: { type: ["string", "null"] },
                  bodySite: { type: ["string", "null"] },
                },
                required: ["name", "metricKey", "value", "secondaryValue", "unit", "referenceMin", "referenceMax", "referenceText", "context", "bodySite"],
              },
            },
            medications: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  dose: { type: ["string", "null"] },
                  frequency: { type: ["string", "null"] },
                  duration: { type: ["string", "null"] },
                  quantity: { type: ["string", "null"] },
                },
                required: ["name", "dose", "frequency", "duration", "quantity"],
              },
            },
            followUps: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string" },
                  explicitDate: { type: ["string", "null"] },
                  recommendedAfter: {
                    anyOf: [
                      { type: "null" },
                      {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          value: { type: "number" },
                          unit: {
                            type: "string",
                            enum: ["days", "weeks", "months", "years"],
                          },
                        },
                        required: ["value", "unit"],
                      },
                    ],
                  },
                  sourceText: { type: ["string", "null"] },
                },
                required: ["title", "explicitDate", "recommendedAfter", "sourceText"],
              },
            },
            prescriptionAnalysis: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    isHandwritten: { type: "boolean" },
                    hasUnreadableMedicationText: { type: "boolean" },
                    outcome: { type: "string", enum: prescriptionOutcomes },
                    message: { type: ["string", "null"] },
                  },
                  required: ["isHandwritten", "hasUnreadableMedicationText", "outcome", "message"],
                },
              ],
            },
          },
          required: ["documentType", "patient", "documentDate", "provider", "doctor", "measurements", "medications", "followUps", "prescriptionAnalysis"],
        };
