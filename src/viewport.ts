/**
 * Pages whose images depend on the window: its width, its height and its device
 * pixel ratio (DPR — how many device pixels draw one CSS pixel) (CAPTURE-422).
 *
 * A capture records only the variants the capturing browser asked for, in the
 * window it had (BrowserHive: 1280×800, DPR 1). A replay that opens the page in
 * another window asks for other variants, and those are not in the archive. A
 * replay viewer that puts the page back into the capture's window asks for the
 * captured ones again. These pages make that visible: every image is an SVG that
 * draws its own name, and `/__request-counts` says which names a load asked for.
 *
 * Each page varies **one** thing, and in one way:
 *
 * - `/viewport/picture-width` — `<picture>` sources by width (the browser picks)
 * - `/viewport/picture-height` — `<picture>` sources by height (the browser picks)
 * - `/viewport/js-dpr` — page script reads `devicePixelRatio`
 * - `/viewport/js-height` — page script asks `matchMedia` for the height
 * - `/viewport/image-set` — CSS `image-set()` and `@media (min-resolution)`
 *
 * The bands are the ones apple.com/jp uses (734 / 1068 / 1440 px wide, 776 px
 * tall, 1.5 for "retina"), so a fix that works here is a fix for that page.
 * {@link viewportImages} says, for a window, which images each page asks for.
 */

/** Width bands of `/viewport/picture-width`: a window up to `max` CSS px wide is in that band. */
export const WIDTH_BANDS = [
  { name: "s", max: 734 },
  { name: "m", max: 1068 },
  { name: "l", max: 1440 },
] as const;
/** The band above the last {@link WIDTH_BANDS} entry. */
export const WIDEST_BAND = "xl";
/** A window at least this many CSS px tall is "tall". */
export const TALL_MIN_HEIGHT = 776;
/** A DPR at least this high counts as "2x" for page script (what apple.com/jp calls retina). */
export const SCRIPT_RETINA_MIN_DPR = 1.5;

/** A window, as a page sees it: CSS px and device pixel ratio. */
export interface ViewportWindow {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

const widthBand = (width: number): string => WIDTH_BANDS.find((band) => width <= band.max)?.name ?? WIDEST_BAND;
const heightBand = (height: number): string => (height >= TALL_MIN_HEIGHT ? "tall" : "short");
/**
 * What `srcset`'s `1x`/`2x` and CSS resolution pick, for the windows the tests open (DPR 1 and 2).
 * Between them a browser may take either candidate.
 */
const density = (dpr: number): string => (dpr > 1 ? "2x" : "1x");

/** The image names each page asks for in `window`, by page path. */
export const viewportImages = (window: ViewportWindow): Readonly<Record<string, readonly string[]>> => ({
  "/viewport/picture-width": [`width-${widthBand(window.width)}-${density(window.dpr)}`],
  "/viewport/picture-height": [`height-${heightBand(window.height)}-${density(window.dpr)}`],
  "/viewport/js-dpr": [`js-${window.dpr >= SCRIPT_RETINA_MIN_DPR ? "2x" : "1x"}`],
  "/viewport/js-height": [`jsheight-${heightBand(window.height)}`],
  "/viewport/image-set": [`set-${density(window.dpr)}`, `res-${density(window.dpr)}`],
});

/** Every image name a page here can ask for. `/viewport/img/<name>.svg` answers these and nothing else. */
export const VIEWPORT_IMAGE_NAMES: readonly string[] = [
  ...[...WIDTH_BANDS.map((band) => band.name), WIDEST_BAND].flatMap((band) => [`width-${band}-1x`, `width-${band}-2x`]),
  ...["tall", "short"].flatMap((band) => [`height-${band}-1x`, `height-${band}-2x`]),
  "js-1x",
  "js-2x",
  "jsheight-tall",
  "jsheight-short",
  "set-1x",
  "set-2x",
  "res-1x",
  "res-2x",
];

const img = (name: string): string => `/viewport/img/${name}.svg`;

const page = (title: string, body: string, head = ""): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>${head}</head><body>
<h1>${title}</h1>
${body}
</body></html>`;

/** A `<source>` for one band: its 1x and 2x images. */
const source = (media: string, name: string): string =>
  `<source media="${media}" srcset="${img(`${name}-1x`)}, ${img(`${name}-2x`)} 2x">`;

const PICTURE_WIDTH = (() => {
  const sources = WIDTH_BANDS.map((band) => source(`(max-width: ${String(band.max)}px)`, `width-${band.name}`));
  return page(
    "picture-width",
    `<picture>
${sources.join("\n")}
<img id="pick" src="${img(`width-${WIDEST_BAND}-1x`)}" srcset="${img(`width-${WIDEST_BAND}-1x`)}, ${img(`width-${WIDEST_BAND}-2x`)} 2x" alt="width" width="320" height="80">
</picture>`,
  );
})();

const PICTURE_HEIGHT = page(
  "picture-height",
  `<picture>
${source(`(min-height: ${String(TALL_MIN_HEIGHT)}px)`, "height-tall")}
<img id="pick" src="${img("height-short-1x")}" srcset="${img("height-short-1x")}, ${img("height-short-2x")} 2x" alt="height" width="320" height="80">
</picture>`,
);

/** Appends `<img id="pick">` for `name`, and names the page after it. */
const appendScript = (name: string): string => `const img = document.createElement("img");
  img.id = "pick";
  img.src = "/viewport/img/" + ${name} + ".svg";
  img.alt = ${name};
  img.width = 320;
  img.height = 80;
  document.body.appendChild(img);
  document.title = ${name};`;

/** Reads `devicePixelRatio` once, as it runs, the way apple.com/jp names its videos. */
export const JS_DPR_SCRIPT = `(() => {
  const name = "js-" + (window.devicePixelRatio >= ${String(SCRIPT_RETINA_MIN_DPR)} ? "2x" : "1x");
  ${appendScript("name")}
})();
`;

/** Asks `matchMedia` for the height once, as it runs. */
export const JS_HEIGHT_SCRIPT = `(() => {
  const name = "jsheight-" + (window.matchMedia("(min-height: ${String(TALL_MIN_HEIGHT)}px)").matches ? "tall" : "short");
  ${appendScript("name")}
})();
`;

const IMAGE_SET = page(
  "image-set",
  `<div id="set" class="box">image-set()</div>
<div id="res" class="box">min-resolution</div>`,
  `<style>
.box { width: 320px; height: 80px; background-size: 320px 80px; }
#set { background-image: image-set(url("${img("set-1x")}") 1x, url("${img("set-2x")}") 2x); }
#res { background-image: url("${img("res-1x")}"); }
@media (min-resolution: 2dppx) { #res { background-image: url("${img("res-2x")}"); } }
</style>`,
);

/** The pages `/viewport/` links to. */
const VIEWPORT_INDEX_LINKS = [
  "/viewport/picture-width",
  "/viewport/picture-height",
  "/viewport/js-dpr",
  "/viewport/js-height",
  "/viewport/image-set",
] as const;

/** One body under `/viewport/`. */
export interface ViewportFile {
  readonly type: string;
  readonly body: string;
}

const HTML = "text/html";
const JS = "text/javascript";

/** Every static body under `/viewport/`, by path. The server sends each one from here. */
export const VIEWPORT_FILES: Readonly<Record<string, ViewportFile>> = {
  "/viewport/": {
    type: HTML,
    body: page("viewport", VIEWPORT_INDEX_LINKS.map((path) => `<a href="${path}">${path}</a>`).join("\n")),
  },
  "/viewport/picture-width": { type: HTML, body: PICTURE_WIDTH },
  "/viewport/picture-height": { type: HTML, body: PICTURE_HEIGHT },
  "/viewport/js-dpr": { type: HTML, body: page("js-dpr", `<script src="/viewport/js-dpr.js"></script>`) },
  "/viewport/js-dpr.js": { type: JS, body: JS_DPR_SCRIPT },
  "/viewport/js-height": { type: HTML, body: page("js-height", `<script src="/viewport/js-height.js"></script>`) },
  "/viewport/js-height.js": { type: JS, body: JS_HEIGHT_SCRIPT },
  "/viewport/image-set": { type: HTML, body: IMAGE_SET },
};

/** `/viewport/img/<name>.svg` for one of {@link VIEWPORT_IMAGE_NAMES}: the name, drawn as text. */
export const viewportImageSvg = (name: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">
<rect width="320" height="80" fill="#efe"/>
<text x="160" y="50" font-family="monospace" font-size="28" text-anchor="middle">${name}</text>
</svg>
`;
