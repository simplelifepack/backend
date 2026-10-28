import type { RequestHandler } from "express";

// Process-local memory admission; this complements account/IP rate limits.
export function createAdmissionLimit(maximum: number): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= maximum) {
      res.setHeader("Retry-After", "2");
      res.status(503).json({ message: "Service is busy. Please retry shortly." });
      return;
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
      res.removeListener("finish", release);
      res.removeListener("close", release);
    };
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

// Service work can outlive a disconnected HTTP response. Hold its slot until
// actual completion, including rejection/cancellation, without an unbounded queue.
export function createWorkLimit(maximum: number) {
  let active = 0;
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active >= maximum) throw Object.assign(new Error("Service is busy. Please retry shortly."), { statusCode: 503, code: "RESOURCE_BUSY" });
    active += 1;
    try { return await work(); } finally { active -= 1; }
  };
}
export const withDocumentAIAdmission = createWorkLimit(4);
export const withPackageAIAdmission = createWorkLimit(5);
export const withImportAdmission = createWorkLimit(3);
