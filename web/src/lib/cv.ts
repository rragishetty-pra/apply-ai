import "server-only";
import { extractParagraphs } from "./docx";

export interface ParsedCV {
  format: "docx" | "pdf";
  text: string;
  paragraphs: { i: number; text: string }[] | null;
}

export async function parseCV(filename: string, data: Uint8Array): Promise<ParsedCV> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) {
    const paragraphs = await extractParagraphs(data);
    return { format: "docx", text: paragraphs.map((p) => p.text).join("\n"), paragraphs };
  }
  if (lower.endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = (Array.isArray(text) ? text.join("\n") : text).replace(/[ \t]+\n/g, "\n").trim();
    if (clean.length < 200) throw new Error("Couldn't read text from this PDF (it may be a scanned image). Please upload a .docx.");
    return { format: "pdf", text: clean, paragraphs: null };
  }
  throw new Error("Please upload your CV as a Word (.docx) or PDF file.");
}
