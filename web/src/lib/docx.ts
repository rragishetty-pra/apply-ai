/**
 * Layout-preserving DOCX editing.
 *
 * Tailor never redesigns a CV. It only swaps the wording of chosen paragraphs
 * inside the user's own Word file, so fonts, bullets, spacing, tables and
 * sections stay exactly as the user made them.
 */
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

type El = Element;

interface ParsedDoc {
  zip: JSZip;
  doc: Document;
  paragraphs: El[];
  textNodes: Map<El, El[]>; // paragraph → its own <w:t> nodes (not those of nested paragraphs)
}

async function parse(buf: ArrayBuffer | Uint8Array): Promise<ParsedDoc> {
  const zip = await JSZip.loadAsync(buf);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("This doesn't look like a Word (.docx) file.");
  const xml = await file.async("string");
  const doc = new DOMParser().parseFromString(xml, "text/xml") as unknown as Document;

  const paragraphs = Array.from(doc.getElementsByTagNameNS(W_NS, "p")) as El[];
  const textNodes = new Map<El, El[]>();
  for (const p of paragraphs) textNodes.set(p, []);

  const all = Array.from(doc.getElementsByTagNameNS(W_NS, "t")) as El[];
  for (const t of all) {
    const owner = ownerParagraph(t);
    if (owner) textNodes.get(owner)?.push(t);
  }
  return { zip, doc, paragraphs, textNodes };
}

function ownerParagraph(node: Node): El | null {
  let cur: Node | null = node.parentNode;
  while (cur) {
    if ((cur as El).localName === "p" && (cur as El).namespaceURI === W_NS) return cur as El;
    cur = cur.parentNode;
  }
  return null;
}

/** Visible text of a paragraph, including tabs, excluding nested paragraphs (text boxes). */
function paragraphText(p: El, own: El[]): string {
  const ownSet = new Set(own);
  let out = "";
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      const el = c as El;
      if (el.nodeType !== 1) continue;
      if (el.namespaceURI === W_NS && el.localName === "p") continue; // nested paragraph
      if (el.namespaceURI === W_NS && el.localName === "t" && ownSet.has(el)) out += el.textContent || "";
      else if (el.namespaceURI === W_NS && el.localName === "tab") out += "\t";
      else if (el.namespaceURI === W_NS && (el.localName === "br" || el.localName === "cr")) out += " ";
      else walk(el);
    }
  };
  walk(p);
  return out;
}

/** Non-empty paragraphs with their index in the document. */
export async function extractParagraphs(buf: ArrayBuffer | Uint8Array): Promise<{ i: number; text: string }[]> {
  const { paragraphs, textNodes } = await parse(buf);
  const out: { i: number; text: string }[] = [];
  paragraphs.forEach((p, i) => {
    const text = paragraphText(p, textNodes.get(p) || []).replace(/\s+$/, "");
    if (text.trim()) out.push({ i, text });
  });
  return out;
}

/**
 * Replace the wording of paragraphs, keeping each paragraph's formatting.
 * If the new text starts with the same leading runs as before (e.g. a bold
 * "Tools:" label), those runs are kept as-is and only the rest changes.
 */
export async function applyEdits(
  buf: ArrayBuffer | Uint8Array,
  edits: { i: number; text: string }[]
): Promise<{ data: Uint8Array; applied: number[] }> {
  const { zip, doc, paragraphs, textNodes } = await parse(buf);
  const applied: number[] = [];

  for (const edit of edits) {
    const p = paragraphs[edit.i];
    const ts = p ? textNodes.get(p) || [] : [];
    if (!p || ts.length === 0) continue;

    // Keep leading runs whose text is unchanged (labels like "Skills: ").
    let keep = 0;
    let prefix = "";
    while (keep < ts.length - 1) {
      const next = prefix + (ts[keep].textContent || "");
      if (next && edit.text.startsWith(next) && next.length < edit.text.length) {
        prefix = next;
        keep++;
      } else break;
    }
    const rest = edit.text.slice(prefix.length);
    setText(ts[keep], rest);
    for (let k = keep + 1; k < ts.length; k++) setText(ts[k], "");
    applied.push(edit.i);
  }

  const xml = new XMLSerializer().serializeToString(doc as never);
  zip.file("word/document.xml", xml);
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { data, applied };
}

function setText(t: El, text: string) {
  while (t.firstChild) t.removeChild(t.firstChild);
  t.appendChild(t.ownerDocument!.createTextNode(text));
  t.setAttribute("xml:space", "preserve");
}
