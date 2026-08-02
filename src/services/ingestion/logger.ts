export function logPipelineStage(stage: string, details: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      scope: "document-ingestion",
      stage,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}
