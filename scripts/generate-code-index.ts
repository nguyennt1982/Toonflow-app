import fg from "fast-glob";
import ts from "typescript";
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
const OUT_DIR = path.join(process.cwd(), ".opencode", "index");

type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "const" | "let" | "var" | "export";

interface SymbolEntry {
  kind: SymbolKind;
  name: string;
  line: number;
}

interface IndexEntry {
  kind: SymbolKind;
  name: string;
  file: string;
  line: number;
}

interface Heading {
  level: number;
  text: string;
  line: number;
}

interface SkillEntry {
  name?: string;
  description?: string;
  tags?: string[];
  headings: Heading[];
}

function relSlash(p: string): string {
  return p.split(path.sep).join("/");
}

function getLine(node: ts.Node, sf: ts.SourceFile): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

function isDefaultExport(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;
}

function extractTs(filePath: string, content: string): SymbolEntry[] {
  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
  const out: SymbolEntry[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      out.push({ kind: isDefaultExport(node) ? "export" : "function", name: node.name.text, line: getLine(node, sf) });
    } else if (ts.isClassDeclaration(node) && node.name) {
      out.push({ kind: "class", name: node.name.text, line: getLine(node, sf) });
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      out.push({ kind: "interface", name: node.name.text, line: getLine(node, sf) });
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      out.push({ kind: "type", name: node.name.text, line: getLine(node, sf) });
    } else if (ts.isEnumDeclaration(node) && node.name) {
      out.push({ kind: "enum", name: node.name.text, line: getLine(node, sf) });
    } else if (ts.isMethodDeclaration(node) && node.name) {
      out.push({ kind: "method", name: node.name.getText(sf), line: getLine(node, sf) });
    } else if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          out.push({ kind: isConst ? "const" : "let", name: decl.name.text, line: getLine(node, sf) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

function parseMarkdown(content: string): { front: Record<string, unknown>; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { front: {}, body: content };
  const front: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const k = line.slice(0, idx).trim();
    let v: unknown = line.slice(idx + 1).trim();
    if (typeof v === "string" && v.startsWith("[") && v.endsWith("]")) {
      v = v
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    front[k] = v;
  }
  return { front, body: content.slice(m[0].length) };
}

function extractMarkdown(content: string): SkillEntry {
  const { front, body } = parseMarkdown(content);
  const headings: Heading[] = [];
  body.split(/\r?\n/).forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.+)$/);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i + 1 });
  });
  return {
    name: typeof front.name === "string" ? front.name : undefined,
    description: typeof front.description === "string" ? front.description : undefined,
    tags: Array.isArray(front.tags) ? (front.tags as string[]) : undefined,
    headings,
  };
}

function fileNameToRoutePath(fileName: string): string {
  let routePath = fileName.replace(/\.ts$/, "");
  routePath = routePath.split(path.sep).join("/");
  routePath = routePath.replace(/\[([^\]]+)\]/g, (_, p1: string) => (p1.startsWith("...") ? "*" : `:${p1}`));
  if (routePath === "index") return "/";
  routePath = routePath.replace(/\/index$/, "");
  routePath = "/" + routePath.replace(/\/+/g, "/").replace(/\/$/, "");
  return routePath;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const symbols: Record<string, IndexEntry[]> = {};
  const routes: Record<string, string> = {};
  const skills: Record<string, SkillEntry> = {};

  let newestMtime = 0;
  let fileCount = 0;
  let symbolCount = 0;
  let routeCount = 0;

  for (const pattern of ROOTS) {
    const files = fg.sync(pattern, { onlyFiles: true, dot: true }).sort();
    for (const file of files) {
      const rel = relSlash(file);
      if (SKIP.has(rel)) continue;
      const stat = fs.statSync(file);
      if (stat.mtimeMs > newestMtime) newestMtime = stat.mtimeMs;
      fileCount++;

      const content = fs.readFileSync(file, "utf8");

      if (rel.endsWith(".md")) {
        skills[rel] = extractMarkdown(content);
        continue;
      }

      const entries = extractTs(file, content);
      symbolCount += entries.length;
      for (const e of entries) {
        if (e.name === "default") continue;
        (symbols[e.name] ??= []).push({ kind: e.kind, name: e.name, file: rel, line: e.line });
      }

      if (rel.startsWith("src/routes/")) {
        const relRoute = relSlash(path.relative("src/routes", file));
        routes[rel] = "/api" + fileNameToRoutePath(relRoute);
        routeCount++;
      }
    }
  }

  const meta = {
    version: 1,
    generatedAt: new Date().toISOString(),
    newestSourceMtime: Math.floor(newestMtime),
    fileCount,
    symbolCount,
    routeCount,
    sourceRoots: ROOTS,
  };

  const json = {
    meta,
    routes,
    skills,
    symbols,
  };
  fs.writeFileSync(path.join(OUT_DIR, "code-index.json"), JSON.stringify(json, null, 1), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "index.meta.json"), JSON.stringify(meta, null, 2), "utf8");

  const flat: string[] = [];
  const allEntries: IndexEntry[] = Object.values(symbols).flat();
  allEntries.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file)));
  for (const s of allEntries) flat.push(`${s.file}:${s.line} ${s.kind} ${s.name}`);
  const routeEntries = Object.entries(routes).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [file, p] of routeEntries) flat.push(`${file}:1 route ${p}`);
  fs.writeFileSync(path.join(OUT_DIR, "code-index.txt"), flat.join("\n") + "\n", "utf8");

  console.log(
    `Indexed ${fileCount} files, ${symbolCount} symbols, ${routeCount} routes → ${relSlash(OUT_DIR)}`,
  );
  console.log(`  skills: ${Object.keys(skills).length}, routes: ${routeCount}, newest mtime: ${new Date(newestMtime).toISOString()}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
