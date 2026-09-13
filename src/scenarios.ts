/**
 * Typed URL contract for every consumer (BrowserHive today) so that scenario
 * paths live in exactly one place and cannot drift between repos.
 *
 * Names say what the route DOES, and parameters say what they MEASURE. A path
 * is read far more often than it is typed, and the reader is usually trying to
 * work out why a test failed.
 *
 * Static scenarios are plain strings; parameterised ones are builder functions.
 * Prefix each with the fixture origin, e.g. `` `http://${ip}:8080` + scenarios.ok ``.
 */
// #region scenarios
export const scenarios = {
  /** Plain 200 HTML, no script and no sub-resources — the success baseline. */
  plainHtml: "/plain-html",
  /**
   * Revalidates on every visit (`no-cache` + `ETag`), so a repeat navigation
   * gets a bodyless `304`. The only route here that can produce one.
   */
  cacheable: "/cacheable",
  /**
   * DOMContentLoaded runs `location.replace(redirectTarget)`.
   *
   * Destroys the JavaScript execution context mid-capture. A server-side 302
   * does NOT reproduce this — the browser follows that before a page exists.
   */
  clientSideRedirect: "/client-side-redirect",
  /** Where {@link scenarios.clientSideRedirect} and the server chain land. */
  redirectTarget: "/redirect-target",
  /** Below-the-fold `loading="lazy"` image + IntersectionObserver — exercises auto-scroll. */
  lazyImages: "/lazy-images",
  /** A page that grows as it is scrolled, so scrolling never reaches an end. */
  endlessFeed: "/endless-feed",
  /**
   * Image variants a 1280px / DPR 1 capture never requests on its own —
   * `srcset`, `<picture><source>`, `data-srcset` and `poster`.
   *
   * Exercises BrowserHive's `autofetch`: without it only the control image
   * (`hero.svg`) arrives, because the browser picks one candidate per element.
   */
  responsiveImages: "/responsive-images",

  /** Fixed cookie-consent overlay — exercises banner dismissal. */
  cookieBanner: "/cookie-banner",
  /**
   * Reports what the browser arrived carrying, then overwrites it with `tag`
   * — exercises `session` isolation.
   *
   * Renders one JSON object into `<pre id="arrival">`:
   *
   *   { "cookie": "<tag|fresh>", "local": "<tag|fresh>", "session": "<tag|fresh>" }
   *
   * Reporting a *value* rather than a yes/no keeps the assertion independent of
   * whatever ran before. Reporting *one object* rather than one element per
   * store keeps the reader unchanged when a store is added.
   *
   * `session` is the interesting one: sessionStorage is carried by the tab, not
   * by the browser context, so it is the only key that can tell "the same
   * context was reused" apart from "the same tab was reused".
   */
  cookieAndStorage: (tag: string): string =>
    `/cookie-and-storage?tag=${encodeURIComponent(tag)}`,

  /** Waits `delayMs` before responding at all — exercises page-load timeouts. */
  slowResponse: (delayMs: number): string => `/slow-response?delayMs=${String(delayMs)}`,
  /** Trickles `bytes` bytes over `overMs` — a response that starts, then stalls. */
  slowBody: (bytes: number, overMs: number): string =>
    `/slow-body?bytes=${String(bytes)}&overMs=${String(overMs)}`,
  /** Responds with a body of `bytes` bytes — exercises response-size caps. */
  largeBody: (bytes: number): string => `/large-body?bytes=${String(bytes)}`,
  /**
   * Fills both web storage areas until they total `bytes` — exercises the caps
   * a consumer puts on the storage values it records.
   *
   * `bytes` is a **total, split evenly between the two areas**, and that is the
   * whole point of the page. Each area has its own quota (~5 MiB in Chrome)
   * counted in UTF-16 code units, while a consumer measuring an archive counts
   * UTF-8: one ASCII character is 1 byte of UTF-8 and 2 of UTF-16, so a single
   * area tops out near 2.5 MB of UTF-8. Asking for more in one area hits the
   * quota before it reaches a consumer's ceiling, and the consumer's cap then
   * never fires — while its test still passes, for the wrong reason.
   *
   * The page reports what it actually stored, per area, in `<pre id="stored">`.
   * A quota failure and a working cap look identical in the archive (both leave
   * values out), so a consumer should read those numbers before concluding its
   * cap did anything.
   */
  largeStorage: (bytes: number): string => `/large-storage?bytes=${String(bytes)}`,
  /** Responds with an arbitrary HTTP status — exercises the non-2xx branch. */
  httpStatus: (code: number): string => `/http-status/${String(code)}`,
  /** Server-side 302 chain of `hops`, ending at {@link scenarios.redirectTarget}. */
  serverRedirectChain: (hops: number): string => `/server-redirect-chain/${String(hops)}`,
  /**
   * Fails (503) the first `failTimes` requests for `key`, then succeeds (200).
   *
   * Deterministic, despite what its old name (`flaky`) suggested. `key`
   * isolates counters so parallel tests do not interfere.
   */
  failsThenSucceeds: (failTimes: number, key: string): string =>
    `/fails-then-succeeds?failTimes=${String(failTimes)}&key=${encodeURIComponent(key)}`,
  /**
   * Holds the page's main thread `holdMs` at a time for `repeatForMs` — makes a
   * consumer's per-operation timeout expire against a real browser.
   */
  blockMainThread: (holdMs: number, repeatForMs: number): string =>
    `/block-main-thread?holdMs=${String(holdMs)}&repeatForMs=${String(repeatForMs)}`,
  /**
   * Fetches `/slow-response` for `takesMs`, starting `afterMs` after load, and
   * changes nothing in the DOM — the network is the only thing still busy.
   *
   * For consumers that end their post-load wait on a signal rather than a
   * timer: a DOM-quiet signal fires before this fetch finishes, a network-quiet
   * one waits for it. Pass a `takesMs` past the consumer's deadline to see how
   * it records "the page was still loading".
   */
  fetchLate: (afterMs: number, takesMs: number): string =>
    `/fetch-late?afterMs=${String(afterMs)}&takesMs=${String(takesMs)}`,
  /**
   * Rewrites a clock every `periodMs` for `forMs` — a page that never settles.
   *
   * The network is quiet from the start; the DOM never is. A consumer waiting
   * for the DOM to go quiet reaches its deadline, and the question this page
   * asks is whether it says so. `periodMs` defaults to 250, `forMs` to the
   * fixture's 30-second ceiling.
   */
  ticker: (periodMs = 250, forMs = 30_000): string =>
    `/ticker?periodMs=${String(periodMs)}&forMs=${String(forMs)}`,
  /**
   * Three same-origin links to {@link scenarios.linkLeaf} — the crawl baseline.
   *
   * Every other link scenario is this page with exactly one thing changed, so a
   * crawler that follows the wrong set can be told apart from one that is simply
   * broken. Also links to {@link scenarios.linkHidden}, which
   * {@link scenarios.robotsTxt} forbids: a crawler that honours robots reaches
   * this page and still never fetches that one.
   */
  linkHub: "/links/hub",
  /**
   * A page with no outbound links — where a crawl's depth stops.
   *
   * `id` only changes the URL. Distinct URLs are what a depth or page budget is
   * counted in, so a fixture that needs "three more pages" needs three ids.
   */
  linkLeaf: (id: number): string => `/links/leaf/${String(id)}`,
  /**
   * {@link scenarios.linkHub} with `rel="nofollow"` on the third link.
   *
   * The first two are the control: a crawler that follows none of them is not
   * honouring `nofollow`, it is failing to parse the page.
   */
  linkNofollow: "/links/nofollow",
  /**
   * Links that leave the origin — a different host, a different port, and a
   * different scheme, plus one same-origin control.
   *
   * The foreign host is under `.invalid` (RFC 2606), which is guaranteed never
   * to resolve. A crawler that wrongly follows it fails against a name that
   * cannot exist rather than reaching a stranger's server.
   */
  linkOffOrigin: "/links/off-origin",
  /**
   * The same leaf twice, once with `#a` — one resource, two spellings.
   *
   * A crawler that does not drop the fragment captures the same page twice and
   * still looks like it worked.
   */
  linkFragments: "/links/fragments",
  /**
   * Three links that exist only after `DOMContentLoaded` builds them.
   *
   * Nothing in the served HTML matches `<a`. A consumer reading the response
   * body finds no links at all; one reading the rendered DOM finds three.
   */
  linkJs: "/links/js",
  /**
   * One link appended `afterMs` after load — measures where a consumer stops
   * looking.
   *
   * A `setTimeout`, deliberately, not an `IntersectionObserver`: the point is a
   * deadline the caller chose, not a callback that may be late. Pass a small
   * `afterMs` to assert the link IS followed, a large one to find the boundary.
   */
  linkJsLate: (afterMs: number): string => `/links/js-late?afterMs=${String(afterMs)}`,
  /**
   * Two pages linking to each other — `a` ⇄ `b`.
   *
   * A crawler without dedupe walks this until some other limit stops it, and
   * then reports that limit as the reason it stopped. Nothing about the run
   * looks wrong.
   */
  linkCycle: (side: "a" | "b"): string => `/links/cycle/${side}`,
  /**
   * `n` same-origin links on one page — for exercising a page budget.
   *
   * The one generated scenario here. Budgets are the only link behaviour that
   * needs more pages than a reader would want to see written out.
   */
  linkFanOut: (n: number): string => `/links/fan-out?n=${String(n)}`,
  /** Reachable, linked from {@link scenarios.linkHub}, and forbidden by {@link scenarios.robotsTxt}. */
  linkHidden: "/links/hidden",
  /**
   * `Disallow: /links/hidden` and `Crawl-delay: 3`. The only robots policy here.
   *
   * Fixed rather than parameterised, because a crawler fetches `/robots.txt`
   * with no query string — a knob could never reach it. Tests assert against
   * these two values.
   *
   * The delay is 3s so that it can be seen to win: a consumer whose own spacing
   * is shorter must end up waiting 3s between requests, and a consumer that
   * ignores robots keeps its own. A value below the consumer's default would be
   * indistinguishable from being ignored.
   */
  robotsTxt: "/robots.txt",

  /** A static asset served from `site/`, e.g. `scenarios.asset("hero.svg")`. */
  asset: (path: string): string => `/assets/${path}`,
} as const;
// #endregion

export type Scenarios = typeof scenarios;
