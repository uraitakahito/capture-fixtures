/**
 * Pages whose sub-resource depends on a random draw made by page script
 * (CAPTURE-378).
 *
 * A capture that records the values page script received from `Math.random`,
 * `crypto.getRandomValues` and `crypto.randomUUID` can hand them back on replay,
 * and then the replayed page asks for the same sub-resource the captured one
 * did. These pages make that visible: each turns one draw into a number `n` in
 * `0 … 999999` and appends ONE `<img id="pick" src="/random/img/<n>.svg">`, so
 * only the picked image is requested, and `/__request-counts` says which number
 * the page picked.
 *
 * A number rather than a handful of colours, so that a replay picking the same
 * image by chance is a one-in-a-million event, not a one-in-four one.
 *
 * Every page is the same except for **one** thing: where the draw comes from
 * (`Math.random`, `getRandomValues`, `randomUUID`), when it happens (a timer),
 * what ran before it (other draws, another script), or where it runs (an
 * iframe, a worker). Five of them are limit pages, written to sit outside
 * what a replay can be expected to hand back — see the docs page.
 *
 * The bodies are static and live in {@link RANDOM_FILES}. The ones that take a
 * parameter — the image, `/random/frame-other`, and `/random/busy` with its
 * script — are built by the functions below.
 */

/** How many numbers a page can pick from: `n` is in `0 … RANDOM_PICKS - 1`. */
const RANDOM_PICKS = 1_000_000;

/**
 * Script lines that show the picked `n`: the image, its `alt`, and the title.
 * Written into every picker so that each file stands on its own — a replay
 * that loses one script must not take another page's picking with it.
 */
const show = (indent: string): string =>
  [
    `const img = document.createElement("img");`,
    `img.id = "pick";`,
    `img.src = "/random/img/" + n + ".svg";`,
    `img.alt = "pick " + n;`,
    `img.width = 320;`,
    `img.height = 80;`,
    `document.body.appendChild(img);`,
    `document.title = "pick " + n;`,
  ]
    .map((line) => indent + line)
    .join("\n");

/** A picker script: `pick` sets `n`, then {@link show}. Wrapped so two pickers on one page share no names. */
const picker = (pick: string): string => `(() => {
  ${pick}
${show("  ")}
})();
`;

const page = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>
<h1>${title}</h1>
${body}
</body></html>`;

/** `Math.random`, once, as the script runs. The baseline every other page varies. */
const PICK_JS = picker(`const n = Math.floor(Math.random() * ${String(RANDOM_PICKS)});`);

/**
 * `crypto.randomUUID`, its first 32 bits. `randomUUID` exists only in a secure
 * context, and this fixture serves plain http: under any name but `localhost`
 * or `127.0.0.1` the browser has no `randomUUID`, and the page says so in its
 * title rather than throwing where nothing shows.
 */
const UUID_JS = `(() => {
  if (typeof crypto.randomUUID !== "function") {
    document.title = "no randomUUID";
    return;
  }
  const n = parseInt(crypto.randomUUID().replace(/-/g, "").slice(0, 8), 16) % ${String(RANDOM_PICKS)};
${show("  ")}
})();
`;

/** `crypto.getRandomValues`, one 32-bit word. */
const BYTES_JS = picker(`const n = crypto.getRandomValues(new Uint32Array(1))[0] % ${String(RANDOM_PICKS)};`);

/** `Math.random` from a timer 300 ms after the script runs — the draw happens after load. */
const LATE_JS = `setTimeout(() => {
  const n = Math.floor(Math.random() * ${String(RANDOM_PICKS)});
${show("  ")}
}, 300);
`;

/** How many draws `/random/noise.js` makes and throws away. */
const RANDOM_NOISE_DRAWS = 40;

/**
 * Draws {@link RANDOM_NOISE_DRAWS} times and keeps nothing. Runs before
 * `pick.js` on `/random/two-scripts`, so the pick is the 41st draw of the page
 * and the first of its own file.
 */
const NOISE_JS = `for (let i = 0; i < ${String(RANDOM_NOISE_DRAWS)}; i += 1) Math.random();
`;

/**
 * Draws `k` extra times, then picks, where `k` is the page's clock in whole
 * milliseconds, mod 5. The extra draws are on a different line from the pick,
 * so the pick is always the same call site — but how many draws came before it
 * from this file changes from one load to the next.
 */
const RACY_JS = `(() => {
  const k = Math.floor(performance.now()) % 5;
  for (let i = 0; i < k; i += 1) Math.random();
  const n = Math.floor(Math.random() * ${String(RANDOM_PICKS)});
${show("  ")}
})();
`;

/**
 * {@link RACY_JS} with every draw made through one helper: the extra draws and
 * the pick all come from the same line, the helper's.
 */
const HELPER_JS = `(() => {
  const r = () => Math.random();
  const k = Math.floor(performance.now()) % 5;
  for (let i = 0; i < k; i += 1) r();
  const n = Math.floor(r() * ${String(RANDOM_PICKS)});
${show("  ")}
})();
`;

/** The clock, not a random source: `Date.now()`, mod a million. */
const TIME_JS = picker(`const n = Date.now() % ${String(RANDOM_PICKS)};`);

/** Starts a dedicated worker that draws, and shows the number it posts back. */
const WORKER_JS = `(() => {
  const worker = new Worker("/random/worker-pick.js");
  worker.onmessage = (event) => {
    const n = event.data;
${show("    ")}
  };
})();
`;

/** The worker's script: `Math.random`, once, in the worker, posted to the page. */
const WORKER_PICK_JS = `postMessage(Math.floor(Math.random() * ${String(RANDOM_PICKS)}));
`;

/** The page's own inline script: the same draw as `pick.js`, with no script file to record. */
const INLINE_SCRIPT = picker(`const n = Math.floor(Math.random() * ${String(RANDOM_PICKS)});`);

/**
 * What the browser's random sources look like from the page, without drawing
 * from any of them. `String(fn)` of a built-in is `function random() { [native
 * code] }`; a source a script replaced reads otherwise, and a global it added
 * shows in the list. The visible text is what a capture keeps, so two captures
 * can be compared on it.
 */
const PROBE_SCRIPT = `document.getElementById("probe").textContent = JSON.stringify({
  mathRandom: String(Math.random),
  getRandomValues: String(crypto.getRandomValues),
  randomUUID: String(crypto.randomUUID),
  globals: Object.getOwnPropertyNames(window).sort(),
});
`;

/** The pages `/random/` links to: every page here but `/random/frame-other`, which needs a second origin. */
const RANDOM_INDEX_LINKS = [
  "/random/pick",
  "/random/uuid",
  "/random/bytes",
  "/random/late",
  "/random/two-scripts",
  "/random/inline",
  "/random/frame",
  "/random/racy",
  "/random/helper",
  "/random/time",
  "/random/worker",
  "/random/busy",
  "/random/probe",
] as const;

/** A page that loads `scripts` in order, each a blocking script at the end of the body. */
const scriptPage = (title: string, ...scripts: string[]): string =>
  page(title, scripts.map((src) => `<script src="${src}"></script>`).join("\n"));

/** One body under `/random/`. */
export interface RandomFile {
  readonly type: string;
  readonly body: string;
}

const HTML = "text/html";
const JS = "text/javascript";

/** Every static body under `/random/`, by path. The server sends each one from here. */
export const RANDOM_FILES: Readonly<Record<string, RandomFile>> = {
  "/random/": {
    type: HTML,
    body: page("random", RANDOM_INDEX_LINKS.map((path) => `<a href="${path}">${path}</a>`).join("\n")),
  },
  "/random/pick": { type: HTML, body: scriptPage("pick", "/random/pick.js") },
  "/random/pick.js": { type: JS, body: PICK_JS },
  "/random/uuid": { type: HTML, body: scriptPage("uuid", "/random/uuid.js") },
  "/random/uuid.js": { type: JS, body: UUID_JS },
  "/random/bytes": { type: HTML, body: scriptPage("bytes", "/random/bytes.js") },
  "/random/bytes.js": { type: JS, body: BYTES_JS },
  "/random/late": { type: HTML, body: scriptPage("late", "/random/late.js") },
  "/random/late.js": { type: JS, body: LATE_JS },
  "/random/two-scripts": { type: HTML, body: scriptPage("two-scripts", "/random/noise.js", "/random/pick.js") },
  "/random/noise.js": { type: JS, body: NOISE_JS },
  "/random/inline": { type: HTML, body: page("inline", `<script>\n${INLINE_SCRIPT}</script>`) },
  "/random/frame": {
    type: HTML,
    body: page("frame", `<iframe src="/random/pick" width="360" height="120"></iframe>`),
  },
  "/random/racy": { type: HTML, body: scriptPage("racy", "/random/racy.js") },
  "/random/racy.js": { type: JS, body: RACY_JS },
  "/random/helper": { type: HTML, body: scriptPage("helper", "/random/helper.js") },
  "/random/helper.js": { type: JS, body: HELPER_JS },
  "/random/time": { type: HTML, body: scriptPage("time", "/random/time.js") },
  "/random/time.js": { type: JS, body: TIME_JS },
  "/random/worker": { type: HTML, body: scriptPage("worker", "/random/worker.js") },
  "/random/worker.js": { type: JS, body: WORKER_JS },
  "/random/worker-pick.js": { type: JS, body: WORKER_PICK_JS },
  "/random/probe": {
    type: HTML,
    body: page("probe", `<pre id="probe">pending</pre>\n<script>\n${PROBE_SCRIPT}</script>`),
  },
};

/**
 * Picked image `n`: the number, as text, the same bytes for the same `n`. The
 * route answers only the spelling the pickers write — `0`, or digits with no
 * leading zero, below {@link RANDOM_PICKS} — so a request log never holds two
 * spellings of one pick.
 */
export const RANDOM_IMAGE_FILE = /^(0|[1-9][0-9]{0,5})\.svg$/;

export const randomImageSvg = (n: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="80" viewBox="0 0 320 80">
<rect width="320" height="80" fill="#eef"/>
<text x="160" y="54" font-family="monospace" font-size="40" text-anchor="middle">${n}</text>
</svg>
`;

/**
 * `/random/pick` in an iframe served by `origin` — another instance of this
 * fixture, under another name. A browser runs a frame from another site in a
 * process of its own.
 */
export const randomFrameOtherHtml = (origin: string): string =>
  page("frame-other", `<iframe src="${origin}/random/pick" width="360" height="120"></iframe>`);

/** Ceiling for `/random/busy`'s `n`, and its default. */
export const MAX_RANDOM_BUSY = 2_000_000;
export const DEFAULT_RANDOM_BUSY = 1_000;

/** Loads `/random/busy.js` with the same `n`. */
export const randomBusyHtml = (count: number): string =>
  scriptPage("busy", `/random/busy.js?n=${String(count)}`);

/** Draws `count` times and keeps nothing, then picks with the next draw. */
export const randomBusyJs = (count: number): string =>
  picker(`for (let i = 0; i < ${String(count)}; i += 1) Math.random();
  const n = Math.floor(Math.random() * ${String(RANDOM_PICKS)});`);
