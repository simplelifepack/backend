// Responses API SSE framing can span arbitrary UTF-8/network chunks.
export async function readProviderStream(response: Response, onDelta: (text: string) => void) {
  if (!response.body) throw new Error("Provider stream unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trimEnd();
        buffer = buffer.slice(end + 1);
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          output += event.delta;
          if (output.length > 100_000) throw new Error("Provider response too large.");
          onDelta(event.delta);
        }
        if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw new Error("Provider stream failed.");
        if (event.type === "response.completed") completed = true;
      }
      if (buffer.length > 200_000) throw new Error("Malformed provider stream.");
      if (done) break;
    }
    if (!completed || !output) throw new Error("Incomplete provider stream.");
    return output;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
