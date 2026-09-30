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
