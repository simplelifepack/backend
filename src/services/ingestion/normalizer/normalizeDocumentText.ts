/* eslint-disable no-control-regex */
export function normalizeDocumentText(text: string) {
  const controlCharacters = new RegExp(
    "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]",
    "g",
  );

  return text
    .replace(/\r\n?/g, "\n")
    .replace(controlCharacters, " ")
    .replace(/[\u00a0\u2000-\u200f\u2028-\u202f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
