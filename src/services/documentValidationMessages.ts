export const documentValidationMessages: Record<string, string> = {
  EMPTY_FILE: "This file is empty. Please choose another file.",
  FILE_CORRUPTED: "This file appears to be corrupted. Please try uploading another copy.",
  UNSUPPORTED_FILE_TYPE: "This file type isn’t supported. Please upload a JPEG, PNG, WebP, or PDF.",
  FILE_SIGNATURE_MISMATCH: "This file’s format doesn’t match its filename. Please export it as a JPEG, PNG, WebP, or PDF and try again.",
  PASSWORD_PROTECTED_FILE: "This PDF is password-protected. Please upload a copy without password protection.",
  INVALID_ENCRYPTION_ENVELOPE: "We couldn’t verify this upload. Please select the file and try uploading it again.",
  UNSAFE_FILE: "This file contains content that isn’t supported. Please upload a plain PDF or image copy.",
};
export function fileTooLargeMessage(maxBytes: number) {
  return `File is too large. Please upload a file no larger than ${Number((maxBytes / (1024 * 1024)).toFixed(3))} MB.`;
}
