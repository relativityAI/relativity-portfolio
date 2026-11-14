/**
 * Document text extraction for the builder agent.
 * Handles PDF, DOCX, CSV, TXT, MD, and JSON — text only, no OCR.
 */

import path from "node:path";

export interface ExtractedDocument {
  filename: string;
  mime_type: string;
  text: string;
  char_count: number;
}

/**
 * Extract text from an uploaded file buffer.
 * Returns plain text only — no OCR, no image processing.
 */
export async function extractText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ExtractedDocument> {
  const ext = path.extname(filename).toLowerCase();
  let text = "";

  if (mimeType === "application/pdf" || ext === ".pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(buffer);
    text = data.text || "";
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    ext === ".txt" ||
    ext === ".md"
  ) {
    text = buffer.toString("utf-8");
  } else if (mimeType === "text/csv" || ext === ".csv") {
    text = buffer.toString("utf-8");
  } else if (ext === ".json") {
    try {
      const parsed = JSON.parse(buffer.toString("utf-8"));
      text = JSON.stringify(parsed, null, 2);
    } catch {
      text = buffer.toString("utf-8");
    }
  } else {
    text = buffer.toString("utf-8");
  }

  // Truncate very large documents to stay within LLM context
  const MAX_CHARS = 30_000;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS) + "\n\n[Document truncated at 30,000 characters]";
  }

  return {
    filename,
    mime_type: mimeType,
    text: text.trim(),
    char_count: text.trim().length,
  };
}
