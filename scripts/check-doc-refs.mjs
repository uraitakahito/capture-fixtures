/**
 * Verify that the Starlight docs-site stays in sync with the TypeScript source.
 *
 * This script is the whole guard here, not a supplement to one. The extractor
 * in docs-site/src/lib/extract.ts does throw on a missing `// #region`, but
 * whether that stops the build depends on the page's extension: on .mdx the
 * throw surfaces through vite and the build fails; on .md — which is every
 * page in capture-fixtures — Starlight's docs loader catches it, logs
 * `[ERROR] [starlight-docs-loader] Error rendering …`, and finishes with
 * exit 0. So `astro build` alone goes green over a doc pointing at code that
 * no longer exists. Measured, not assumed.
 *
 * What is checked here:
 *
 *   1. ```ts file="src/…#region"   → the file exists AND the region marker is present
 *   2. `src/….ts` code-span paths   → the referenced file still exists on disk
 *
 * Region names are compared exactly (a Set of `#region <name>` markers), which
 * also closes a gap the extractor used to have: it matched names with `\b`, so
 * asking for `scenarios` would happily match a marker reading `#region
 * scenarios-v2` and serve the wrong snippet.
 *
 * BrowserHive's version of this script also validates `/terminology/#g-<Term>`
 * links against `@glossary` tags. capture-fixtures has no glossary page, so that check
 * would have nothing to validate — and a check with zero subjects is worse than
 * no check, because it is permanently green and reads as coverage.
 *
 * Run via `pnpm run site:check` (build + this script). Exits 1 with a list of
 * broken references so CI fails the PR. To see it work: rename a `#region` and
 * re-run — the offending doc reference goes red.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS = resolve(ROOT, "docs-site/src/content/docs");
const SRC = resolve(ROOT, "src");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    return entry.isDirectory() ? walk(p) : [p];
  });

// ─── Source facts: what the docs are allowed to reference ──────────────────
const srcText = new Map(
  walk(SRC)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => [relative(ROOT, f), readFileSync(f, "utf8")]),
);

// `// #region <name>` markers, indexed by ROOT-relative file path.
const regionsByFile = new Map();
for (const [rel, text] of srcText) {
  regionsByFile.set(
    rel,
    new Set([...text.matchAll(/\/\/\s*#region\s+(\S+)/g)].map((m) => m[1])),
  );
}

// ─── Scan every doc and collect broken references ──────────────────────────
const problems = [];

for (const file of walk(DOCS).filter((f) => /\.mdx?$/.test(f))) {
  const text = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  // 1. Live code regions: ```ts file="src/…#region"
  for (const [, path, region] of text.matchAll(/file="([^"#]+)#([^"]+)"/g)) {
    if (!existsSync(resolve(ROOT, path))) {
      problems.push(`${rel}: file="${path}" does not exist`);
      continue;
    }
    if (!regionsByFile.get(path)?.has(region)) {
      problems.push(`${rel}: region "${region}" not found in ${path} (renamed or removed?)`);
    }
  }

  // 2. Concrete source-file paths in code spans: `src/….ts`
  for (const [, path] of text.matchAll(/`(src\/[A-Za-z0-9_\-/]+\.ts)`/g)) {
    if (!existsSync(resolve(ROOT, path))) {
      problems.push(`${rel}: \`${path}\` does not exist (renamed or moved?)`);
    }
  }
}

// ─── Report ────────────────────────────────────────────────────────────────
if (problems.length > 0) {
  console.error(`✗ doc-ref check failed (${problems.length} broken reference(s)):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nDocs reference code that no longer matches. Update the doc or restore the code.",
  );
  process.exit(1);
}

console.log("✓ doc-ref check passed: all live regions and src paths resolve");
