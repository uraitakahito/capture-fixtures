/**
 * Pages for testing that a consumer keeps nothing from a page it was told not
 * to keep.
 *
 * A marked page writes three tokens — one each into its title, its visible
 * text and a link's text — and into no URL. That split is the whole design:
 *
 * - A URL reaches an archive's index whether or not the page was kept, so a
 *   token in a URL would be found in every archive and prove nothing.
 * - Anything a consumer derives from the page itself — a screenshot's HTML,
 *   extracted links, a recorded title and text, an accessibility tree —
 *   carries the tokens only if the consumer kept something of the page.
 *
 * The page also loads an image and fetches a JSON document, tagged in their
 * query strings. Those two requests are how a test tells "rendered, then not
 * kept" apart from "never loaded": they reach the request log either way.
 */

/** The strings a consumer must not keep from marked page `name` under `tag`. */
export interface MarkedTokens {
  /** Written into `<title>`. */
  readonly title: string;
  /** Written into the page's visible text. */
  readonly text: string;
  /** Written into a link's text — the `href` itself carries no token. */
  readonly link: string;
}

/**
 * Spelled here so a consumer's test never has to. A copy of the spelling in
 * another repo would still pass after this one changed, and then find nothing
 * — which is exactly what a test for "nothing was kept" wants to see.
 */
export const markedTokens = (name: string, tag: string): MarkedTokens => ({
  title: `title-${name}-${tag}`,
  text: `text-${name}-${tag}`,
  link: `link-${name}-${tag}`,
});

/**
 * The ways the `/marked/kinds` page asks for `data.json` outside an ordinary
 * fetch, each written into the request's `from` as `<name>-<kind>`: a beacon, a
 * `keepalive` fetch, `<link rel="prefetch">`, `<link rel="preload">` and an
 * `EventSource`. A consumer that holds back requests has to hold back these too.
 */
export const MARKED_KINDS = ["beacon", "keepalive", "prefetch", "preload", "eventsource"] as const;

/** One of {@link MARKED_KINDS}. */
export type MarkedKind = (typeof MARKED_KINDS)[number];

/**
 * The ways the `/marked/opener` page asks for a new window: `window.open`, a
 * click on a link with `target="_blank"`, a `submit()` of a form with
 * `target="_blank"`, and a script-made click carrying the ctrl and meta keys,
 * which a browser turns into a new tab. A consumer that keeps the page from
 * opening windows has to keep it from opening one every way.
 */
export const MARKED_WINDOW_WAYS = ["open", "link", "form", "modifier"] as const;

/** One of {@link MARKED_WINDOW_WAYS}. */
export type MarkedWindowWay = (typeof MARKED_WINDOW_WAYS)[number];

/** The strings the `/marked/search` page `name` shows under `tag`. */
export interface MarkedSearchTokens {
  /** In the page as served. Drawing a search's answer takes it out. */
  readonly before: string;
  /** In the search's answer, and in the page once drawn where `before` was. */
  readonly after: string;
}

/**
 * The page shows one or the other, never both, so a consumer that keeps the
 * page at more than one moment can be asked which moment each copy is from.
 * Spelled here for the reason {@link markedTokens} is, and written into no URL
 * for the reason those are: the page's URLs carry `name` and `tag`, never the
 * two joined.
 */
export const markedSearchTokens = (name: string, tag: string): MarkedSearchTokens => ({
  before: `before-${name}-${tag}`,
  after: `after-${name}-${tag}`,
});

/**
 * The two pages of `/marked/console`. `writes` reaches its console every way of
 * {@link MARKED_CONSOLE_WAYS}; `silent` is the same page with every write taken
 * out. A consumer that keeps a page's console keeps a line for each way from the
 * first and nothing from the second.
 */
export const MARKED_CONSOLE_MODES = ["writes", "silent"] as const;

/** One of {@link MARKED_CONSOLE_MODES}. */
export type MarkedConsoleMode = (typeof MARKED_CONSOLE_MODES)[number];

// #region console-ways
/** The console methods `/marked/console/writes` calls while its document loads, and again once it has. */
export const MARKED_CONSOLE_METHODS = ["log", "info", "warn", "error"] as const;

/**
 * The ways `/marked/console/writes` reaches the console, each with a token of its
 * own, so a consumer's line says which way it came:
 *
 * - `loading-<method>`: `console.<method>` while the document loads
 * - `loaded-<method>`: the same, from a timer after the load event
 * - `throw`: an uncaught exception, an `Error` whose message is the token
 * - `reject`: an unhandled rejection, the same
 * - `frame`: `console.log` in the page's iframe
 * - `worker`: `console.log` in the page's dedicated worker
 */
export const MARKED_CONSOLE_WAYS = [
  ...MARKED_CONSOLE_METHODS.map((method) => `loading-${method}` as const),
  ...MARKED_CONSOLE_METHODS.map((method) => `loaded-${method}` as const),
  "throw",
  "reject",
  "frame",
  "worker",
] as const;
// #endregion

/** One of {@link MARKED_CONSOLE_METHODS}. */
export type MarkedConsoleMethod = (typeof MARKED_CONSOLE_METHODS)[number];

/** One of {@link MARKED_CONSOLE_WAYS}. */
export type MarkedConsoleWay = (typeof MARKED_CONSOLE_WAYS)[number];

/** The tokens `/marked/console/writes` page `name` writes under `tag`, one per way. */
export type MarkedConsoleTokens = Readonly<Record<MarkedConsoleWay, string>>;

/**
 * `<way>-<name>-<tag>`, spelled here for the reason {@link markedTokens} is. The
 * page joins each token as it runs, from the way, `name` and `tag` written apart,
 * so none of its URLs and none of its response bodies spells one: a token leaves
 * the page only through its console.
 */
export const markedConsoleTokens = (name: string, tag: string): MarkedConsoleTokens =>
  Object.fromEntries(MARKED_CONSOLE_WAYS.map((way) => [way, `${way}-${name}-${tag}`])) as Record<
    MarkedConsoleWay,
    string
  >;
