import { readFileSync, writeFileSync } from "fs";
import { extractParagraphs, applyEdits } from "../src/lib/docx.ts";

const [inPath, outPath] = process.argv.slice(2);
const buf = readFileSync(inPath);
const paras = await extractParagraphs(buf);
console.log("PARAGRAPHS:");
for (const p of paras) console.log(`  [${p.i}] ${JSON.stringify(p.text)}`);

const find = (s: string) => paras.find((p) => p.text.includes(s))!.i;
const edits = [
  { i: find("ETL tester"), text: "ETL test lead with 8 years of experience validating data warehouse loads, building SQL-based reconciliation checks and leading QA teams on banking projects." },
  { i: find("Tools:"), text: "Tools: Informatica, Oracle, SQL Server, HP ALM, JIRA, Unix shell basics" },
  { i: find("Validated source"), text: "Validated source-to-target mappings and SQL reconciliation for nightly loads across 40+ tables; logged and tracked defects in JIRA." },
];
const { data, applied } = await applyEdits(buf, edits);
writeFileSync(outPath, data);
console.log("APPLIED:", applied);
const after = await extractParagraphs(data);
console.log("AFTER:");
for (const p of after) console.log(`  [${p.i}] ${JSON.stringify(p.text)}`);

// Safety checks: contact line, tab-aligned company/date line, padded rewrites must be rejected.
const { vetEdits } = await import("../src/lib/vet.ts");
const v = vetEdits(paras, [
  { i: find("ETL tester"), text: edits[0].text, why: "ok" },
  { i: find("ravi.k@"), text: "ravi@new.com", why: "contact — must reject" },
  { i: find("Acme"), text: "Acme Data Services\tJan 2017 – Present", why: "dates — must reject" },
  { i: find("Led a team"), text: "Led a team of 6 testers ".repeat(6), why: "too long — must reject" },
  { i: 999, text: "nope", why: "bad index — must reject" },
]);
console.log("VET accepted:", v.accepted.map((a) => a.i), "rejected:", v.rejected);
if (v.accepted.length !== 1 || v.rejected !== 4) { console.error("VET TEST FAILED"); process.exit(1); }
console.log("All tailoring checks passed.");
