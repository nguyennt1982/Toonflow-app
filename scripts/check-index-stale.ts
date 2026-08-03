import fg from "fast-glob";
import fs from "fs";
import path from "path";

const ROOTS = [
  "src/**/*.ts",
  "scripts/**/*.ts",
  "data/skills/**/*.md",
  "data/vendor/**/*.ts",
  "data/modelPrompt/**/*.md",
];

const SKIP = new Set(["src/router.ts", "src/types/database.d.ts"]);
const META = path.join(process.cwd(), ".opencode", "index", "index.meta.json");
const EMBED_META = path.join(process.cwd(), ".opencode", "index", "embeddings.meta.json");

function newestMtime(): number {
  let max = 0;
  for (const pattern of ROOTS) {
    for (const file of fg.sync(pattern, { onlyFiles: true, dot: true })) {
      const rel = file.split(path.sep).join("/");
      if (SKIP.has(rel)) continue;
      const st = fs.statSync(file);
      if (st.mtimeMs > max) max = st.mtimeMs;
    }
  }
  return Math.floor(max);
}

if (!fs.existsSync(META)) {
  console.log("NO_INDEX (run: yarn index:generate)");
  process.exit(2);
}

const meta = JSON.parse(fs.readFileSync(META, "utf8"));
const current = newestMtime();

if (current > meta.newestSourceMtime) {
  console.log(
    `STALE (index: ${new Date(meta.newestSourceMtime).toISOString()}, newest source: ${new Date(current).toISOString()})`,
  );
  process.exit(1);
}

const embedFresh = fs.existsSync(EMBED_META)
  ? JSON.parse(fs.readFileSync(EMBED_META, "utf8")).newestSourceMtime >= current
  : false;
console.log("FRESH" + (embedFresh ? "" : " — EMBEDDINGS_STALE (run: yarn index:embed)"));
process.exit(0);
