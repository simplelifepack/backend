declare module "word-extractor" {
  class ExtractedWordDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
    getFooters(): string;
  }

  class WordExtractor {
    extract(source: string | Buffer): Promise<ExtractedWordDocument>;
  }

  export = WordExtractor;
}
