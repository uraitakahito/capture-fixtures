/**
 * The one place documentation pulls facts out of the source.
 *
 * capture-fixtures only needs a single extractor — `// #region` snippets, so a page can
 * show real code rather than a copy that quietly drifts. BrowserHive's version
 * of this file also builds a glossary and type tables via ts-morph; capture-fixtures has
 * neither a glossary nor an interface worth tabulating, so this reads the file
 * directly and drops the dependency.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The capture-fixtures root. `docs-site` sits directly under it, and every script
// (astro dev/build, node) runs with `docs-site` as its cwd — so the parent is
// the repo. `import.meta.url` is not usable here: the astro build bundles this
// file and the URL becomes a path inside `dist`.
const ROOT = resolve(process.cwd(), "..");

/**
 * The current text between `// #region <name>` and `// #endregion`.
 *
 * Throws when the region is gone — but whether that stops the build has
 * depended on the page's extension and on the versions installed, which is not
 * obvious and was measured rather than assumed:
 *
 *   .mdx — the throw surfaces through @astrojs/mdx's vite plugin and the
 *          build fails, exit 1 (Starlight 0.41.4 / Astro 7.1.4).
 *   .md  — Starlight's docs loader logs
 *          `[ERROR] [starlight-docs-loader] Error rendering …`. On Starlight
 *          0.41.4 / Astro 7.1.4 the build then finished with exit 0 and
 *          "Complete!"; on Starlight 0.41.11 / Astro 7.4.4 it exits 1
 *          (measured 2026-11-13).
 *
 * Every page in capture-fixtures is .md, so here the build is not a guard to rely
 * on: it has let a missing region through on one pair of versions and stopped
 * on another. The one that holds the line is scripts/check-doc-refs.mjs, which
 * exits non-zero for both kinds. `pnpm run site:check` runs both; the workflows
 * run `site:check`, never `site:build` alone.
 *
 * The name must run to the end of its line. `\b` is not enough: a word
 * boundary sits between `s` and `-`, so a region named `scenarios` would also
 * match a marker reading `#region scenarios-v2` and quietly serve the wrong
 * snippet — the exact drift this mechanism exists to prevent.
 */
export function sourceRegion(file: string, region: string): string {
  const text = readFileSync(resolve(ROOT, file), "utf8");
  const re = new RegExp(
    String.raw`//\s*#region\s+${region}[ \t]*\r?$([\s\S]*?)//\s*#endregion`,
    "m",
  );
  const m = re.exec(text);
  if (!m) throw new Error(`region '${region}' not found in ${file}`);
  return (m[1] ?? "").replace(/^\n/, "").replace(/\s+$/, "");
}
