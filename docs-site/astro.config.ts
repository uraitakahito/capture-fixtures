import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";
import mdastCodeRegion from "./src/plugins/mdast-code-region";
import hastRebaseLinks from "./src/plugins/hast-rebase-links";

const BASE = "/capture-fixtures";

export default defineConfig({
  site: "https://uraitakahito.github.io",
  base: BASE,
  integrations: [
    starlight({
      title: "capture-fixtures Docs",
      // Keep code tokens inside reference tables on one line; the scenario
      // table's paths and query strings are long enough to wrap badly.
      customCss: ["./src/styles/tables.css"],
      // English is the root locale (no prefix); Japanese lives under /ja/.
      // Same layout as BrowserHive — an untranslated ja page falls back to
      // English automatically.
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/uraitakahito/capture-fixtures" },
      ],
      // Every entry carries a `ja` translation. Starlight localises pages but
      // not navigation, so without these the Japanese docs are translated
      // pages hanging off an English index.
      sidebar: [
        { label: "Overview", translations: { ja: "概要" }, slug: "index" },
        { label: "Quickstart", translations: { ja: "クイックスタート" }, slug: "quickstart" },
        { label: "Scenarios", translations: { ja: "シナリオ" }, slug: "scenarios" },
        { label: "Development", translations: { ja: "開発" }, slug: "development" },
        // The consumer. BrowserHive is the only repository that uses capture-fixtures,
        // and its "Running the tests" page is the worked example the Quickstart
        // points at — so the exit belongs in the nav rather than buried in prose.
      ],
    }),
  ],
  // ```ts file="src/…#region" is replaced with the real source at build time.
  markdown: {
    // Astro 7.2 の既定プロセッサ。legacy の remarkPlugins/rehypePlugins は
    // @astrojs/markdown-remark(unified) を要求するので、そちらは使わない。
    processor: satteri({
      mdastPlugins: [mdastCodeRegion],
      hastPlugins: [hastRebaseLinks],
    }),
  },
});
