import fg from "fast-glob";
import fs from "fs";
import path from "path";
import { pipeline, env as transformersEnv } from "@huggingface/transformers";

const ROOTS = [
  "src/**/*.ts",
  "scripts/**/*.ts",
  "data/skills/**/*.md",
  "data/vendor/**/*.ts",
  "data/modelPrompt/**/*.md",
];

const ROOT = process.cwd();
const MODELS_DIR = path.join(ROOT, "data", "models");
const EMBED_PATH = path.join(ROOT, ".opencode", "index", "embeddings.json");

function parseArgs(argv: string[]): { query: string; top: number } {
  let top = 10;
  let query = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--top") top = parseInt(argv[i + 1] ?? "10", 10) || 10;
    else if (argv[i] !== "--") query = argv[i];
  }
  return { query, top };
}

function newestSourceMtime(): number {
  let max = 0;
  for (const pattern of ROOTS) {
    for (const file of fg.sync(pattern, { onlyFiles: true, dot: true })) {
      const st = fs.statSync(file);
      if (st.mtimeMs > max) max = st.mtimeMs;
    }
  }
  return Math.floor(max);
}

let extractor: any = null;

async function getEmbedding(text: string): Promise<number[]> {
  if (!extractor) {
    transformersEnv.allowRemoteModels = false;
    transformersEnv.allowLocalModels = true;
    transformersEnv.localModelPath = (MODELS_DIR + path.sep).replace(/\\/g, "/") + "/";
    extractor = await pipeline("feature-extraction", "all-MiniLM-L6-v2", {
      dtype: "fp16",
      session_options: { executionProviders: ["cpu"], intraOpNumThreads: 1, graphOptimizationLevel: "all" },
    } as any);
  }
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(out.data as Float32Array);
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

async function main() {
  const { query, top } = parseArgs(process.argv.slice(2));
  if (!query) {
    console.error('usage: yarn index:search "natural language query" [--top N]');
    process.exit(1);
  }
  if (!fs.existsSync(EMBED_PATH)) {
    console.error("No embeddings found. Run `yarn index:embed` first.");
    process.exit(2);
  }

  const data = JSON.parse(fs.readFileSync(EMBED_PATH, "utf8"));
  const meta = data.meta;
  const current = newestSourceMtime();
  if (current > (meta.newestSourceMtime ?? 0)) {
    console.warn("⚠ embeddings may be stale — run `yarn index:embed` to refresh\n");
  }

  const q = await getEmbedding(query);
  const results: { sim: number; file: string; line: number; text: string }[] = [];
  for (const entry of data.entries) {
    for (const c of entry.chunks) {
      const sim = dot(q, c.embedding);
      if (sim > 0.1) results.push({ sim, file: entry.file, line: c.line, text: c.text });
    }
  }
  results.sort((a, b) => b.sim - a.sim);

  const shown = results.slice(0, top);
  console.log(`query: "${query}" — top ${shown.length} of ${results.length} chunks\n`);
  for (const r of shown) {
    const snippet = r.text
      .split("\n")
      .slice(0, 4)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" │ ");
    console.log(`[${r.sim.toFixed(3)}] ${r.file}:${r.line}`);
    console.log(`    ${truncate(snippet, 160)}\n`);
  }
}

main().catch((e) => {
  console.error("search FAIL:", e && e.message ? e.message : e);
  process.exit(1);
});
