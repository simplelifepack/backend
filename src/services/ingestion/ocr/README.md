OCR engines are intentionally isolated from classification.

Wire image and scanned-PDF OCR here when an OCR runtime is available. The pipeline
expects OCR to return text/page text only; rules must never inspect image or PDF
metadata.
