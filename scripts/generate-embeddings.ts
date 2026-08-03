import fg from "fast-glob";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline, env as transformersEnv } from "@huggingface/transformers";

const ROOTS = [
  "src/**/*.ts",
  "scripts/**/*.ts",
  "data/skills/**/*.md",
  "data/vendor/**/*.ts",
  "data/modelPrompt/**/*.md",
];

const SKIP = new Set(["src/router.ts", "src/types/database.d.ts"]);
const ROOT = process.cwd();
const MODELS_DIR = path.join(ROOT, "data", "models");
const OUT_DIR = path.join(ROOT, ".opencode", "index");
const STORE_DIR = path.join(OUT_DIR, "embeddings");
const MANIFEST_PATH = path.join(OUT_DIR, "embeddings.manifest.json");
const MERGED_PATH = path.join(OUT_DIR, "embeddings.json");
const META_PATH = path.join(OUT_DIR, "embeddings.meta.json");

const FORMAT_VERSION = 2;
const CHUNKER_VERSION = 1;
const MODEL_NAME = "all-MiniLM-L6-v2";
const MODEL_DTYPE = "fp16";
const DIM = 384;
const MAX_TOKENS = 480;
const OVERLAP_TOKENS = 60;
const BATCH_SIZE = 32;

interface ManifestFile {
  hash: string;
  storeFile: string;
  chunks: number;
}

interface Manifest {
  formatVersion: number;
  chunkerVersion: number;
  model: string;
  dtype: string;
  dim: number;
  generatedAt: string;
  newestSourceMtime: number;
  files: Record<string, ManifestFile>;
}

interface Chunk {
  line: number;
  text: string;
}

function collectFiles(): string[] {
  const files = new Set<string>();
  for (const pattern of ROOTS) {
    for (const file of fg.sync(pattern, { onlyFiles: true, dot: true })) {
      const rel = file.split(path.sep).join("/");
      if (SKIP.has(rel)) continue;
      files.add(rel);
    }
  }
  return [...files].sort();
}

function newestSourceMtime(files: string[]): number {
  let max = 0;
  for (const file of files) {
    const st = fs.statSync(path.join(ROOT, file));
    if (st.mtimeMs > max) max = st.mtimeMs;
  }
  return Math.floor(max);
}

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s, "utf8").digest("hex");
}

function storeName(file: string): string {
  return sha1(file) + ".json";
}

function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x4e00 && c <= 0x9fff) n += 1;
    else if (c >= 0x3000 && c <= 0x303f) n += 1;
    else if (c >= 0xff00 && c <= 0xffef) n += 1;
  }
  const stripped = text.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, " ");
  for (const w of stripped.split(/\s+/)) if (w) n += 1;
  return Math.max(1, n);
}

function chunkLines(lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < lines.length) {
    let end = start;
    let tok = 0;
    while (end < lines.length) {
      const t = estimateTokens(lines[end]);
      if (tok + t > MAX_TOKENS && end > start) break;
      tok += t;
      end++;
    }
    chunks.push({ line: start + 1, text: lines.slice(start, end).join("\n") });
    if (end >= lines.length) break;
    let next = end;
    let carry = 0;
    while (next > start) {
      const t = estimateTokens(lines[next - 1]);
      if (carry + t > OVERLAP_TOKENS) break;
      carry += t;
      next--;
    }
    if (next === start) next = end;
    start = next;
  }
  return chunks;
}

function loadManifest(): Manifest | null {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

function writeStore(file: string, chunks: { line: number; text: string; embedding: number[] }[]) {
  fs.writeFileSync(path.join(STORE_DIR, storeName(file)), JSON.stringify({ file, chunks }));
}

let extractor: any = null;

async function getEmbeddingBatch(texts: string[]): Promise<number[][]> {
  if (!extractor) {
    transformersEnv.allowRemoteModels = false;
    transformersEnv.allowLocalModels = true;
    transformersEnv.localModelPath = (MODELS_DIR + path.sep).replace(/\\/g, "/") + "/";
    extractor = await pipeline("feature-extraction", "all-MiniLM-L6-v2", {
      dtype: "fp16",
      session_options: { executionProviders: ["cpu"], intraOpNumThreads: 1, graphOptimizationLevel: "all" },
    } as any);
  }
  const out = await extractor(texts, { pooling: "mean", normalize: true });
  const arr = out.data as Float32Array;
  const dim = arr.length / texts.length;
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    result.push(Array.from(arr.subarray(i * dim, (i + 1) * dim)));
  }
  return result;
}

async function main() {
  const files = collectFiles();
  const sourceMtime = newestSourceMtime(files);

  let manifest = loadManifest();
  const needsRebuild =
    !manifest ||
    manifest.formatVersion !== FORMAT_VERSION ||
    manifest.chunkerVersion !== CHUNKER_VERSION ||
    manifest.model !== MODEL_NAME ||
    manifest.dtype !== MODEL_DTYPE ||
    manifest.dim !== DIM;
  if (needsRebuild) {
    fs.rmSync(STORE_DIR, { recursive: true, force: true });
    fs.mkdirSync(STORE_DIR, { recursive: true });
    manifest = {
      formatVersion: FORMAT_VERSION,
      chunkerVersion: CHUNKER_VERSION,
      model: MODEL_NAME,
      dtype: MODEL_DTYPE,
      dim: DIM,
      generatedAt: new Date().toISOString(),
      newestSourceMtime: sourceMtime,
      files: {},
    };
    console.log("[embed] format/chunker/model changed → full rebuild");
  }
  if (!manifest) throw new Error("manifest not initialized");
  fs.mkdirSync(STORE_DIR, { recursive: true });
  for (const file of Object.keys(manifest.files)) {
    if (!files.includes(file)) delete manifest.files[file];
  }

  const changed: { file: string; content: string; hash: string }[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    const hash = sha1(content);
    if (manifest.files[file]?.hash === hash) continue;
    changed.push({ file, content, hash });
  }

  if (changed.length) {
    const allChunks: { file: string; line: number; text: string }[] = [];
    for (const { file, content, hash } of changed) {
      if (!content.trim()) {
        manifest.files[file] = { hash, storeFile: storeName(file), chunks: 0 };
        writeStore(file, []);
        continue;
      }
      for (const c of chunkLines(content.split(/\r?\n/))) allChunks.push({ file, line: c.line, text: c.text });
    }
    console.log(`[embed] ${changed.length} file(s) changed, ${allChunks.length} chunk(s) to embed`);
    if (allChunks.length) {
      const embeddings = new Map<{ file: string; line: number; text: string }, number[]>();
      const ordered = [...allChunks].sort((a, b) => estimateTokens(a.text) - estimateTokens(b.text));
      for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
        const batch = ordered.slice(i, i + BATCH_SIZE);
        const vecs = await getEmbeddingBatch(batch.map((c) => c.text));
        batch.forEach((c, j) => embeddings.set(c, vecs[j]));
        const pct = Math.round((Math.min(i + BATCH_SIZE, allChunks.length) / allChunks.length) * 100);
        process.stdout.write(`\r[embed] ${pct}% (${Math.min(i + BATCH_SIZE, allChunks.length)}/${allChunks.length})`);
      }
      process.stdout.write("\n");

      const byFile = new Map<string, { line: number; text: string; embedding: number[] }[]>();
      for (const c of allChunks) {
        const list = byFile.get(c.file) ?? [];
        list.push({ line: c.line, text: c.text, embedding: embeddings.get(c)! });
        byFile.set(c.file, list);
      }
      for (const [file, chunks] of byFile) {
        manifest.files[file] = { hash: sha1(fs.readFileSync(path.join(ROOT, file), "utf8")), storeFile: storeName(file), chunks: chunks.length };
        writeStore(file, chunks);
      }
    }
  } else {
    console.log("[embed] no changes — all files up to date");
  }

  const referenced = new Set(Object.values(manifest.files).map((f) => f.storeFile));
  fs.mkdirSync(STORE_DIR, { recursive: true });
  for (const f of fs.readdirSync(STORE_DIR)) if (!referenced.has(f)) fs.unlinkSync(path.join(STORE_DIR, f));

  const entries: { file: string; chunks: { line: number; text: string; embedding: number[] }[] }[] = [];
  let totalChunks = 0;
  for (const file of files) {
    const mf = manifest.files[file];
    if (!mf) continue;
    let store: { file: string; chunks: { line: number; text: string; embedding: number[] }[] } | null = null;
    try {
      store = JSON.parse(fs.readFileSync(path.join(STORE_DIR, mf.storeFile), "utf8"));
    } catch {
      continue;
    }
    if (!store) continue;
    entries.push(store);
    totalChunks += store.chunks.length;
  }

  manifest.generatedAt = new Date().toISOString();
  manifest.newestSourceMtime = sourceMtime;
  const meta = {
    model: MODEL_NAME,
    dtype: MODEL_DTYPE,
    dim: DIM,
    chunkerVersion: CHUNKER_VERSION,
    generatedAt: manifest.generatedAt,
    newestSourceMtime: sourceMtime,
    files: entries.length,
    chunks: totalChunks,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(MERGED_PATH, JSON.stringify({ meta, entries }));
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`[embed] done → ${MERGED_PATH} (${meta.files} files, ${meta.chunks} chunks)`);
}

main().catch((e) => {
  console.error("[embed] FAIL:", e && e.message ? e.message : e);
  process.exit(1);
});
