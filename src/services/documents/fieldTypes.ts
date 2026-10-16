// Kept for saved/manual field validation and API compatibility. Legacy source
// labels describe existing stored data; none invokes a local extraction engine.
export type ReviewFieldSource = "template" | "rule" | "generic" | "ocr" | "user" | "ai";
export type ReviewField = {
  id: string; key: string; label: string; value: string; confidence?: number;
  source: ReviewFieldSource; editable: boolean; important?: boolean; pageNumber?: number;
};
