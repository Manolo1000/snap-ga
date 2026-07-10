/**
 * Loads the Georgia SNAP policy corpus from /policy/*.md and concatenates
 * it into a single string suitable for injection into the system prompt
 * under <policy_sections>.
 *
 * The corpus is cached in-memory after first load. In the Next.js API
 * route this means one filesystem read per server process. In the eval
 * runner this means one read per `npm run eval` invocation.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const POLICY_DIR = path.join(__dirname, "..", "policy");

let cachedCorpus: string | null = null;

export async function getPolicyCorpus(): Promise<string> {
  if (cachedCorpus !== null) return cachedCorpus;

  const files = await fs.readdir(POLICY_DIR);
  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();

  if (mdFiles.length === 0) {
    throw new Error(`No .md files found in ${POLICY_DIR}`);
  }

  const contents = await Promise.all(
    mdFiles.map((f) => fs.readFile(path.join(POLICY_DIR, f), "utf-8")),
  );

  cachedCorpus = contents.join("\n\n===SECTION BOUNDARY===\n\n");
  return cachedCorpus;
}

export function corpusFileCount(): number {
  // For diagnostics/logging.
  return cachedCorpus ? cachedCorpus.split("===SECTION BOUNDARY===").length : 0;
}
