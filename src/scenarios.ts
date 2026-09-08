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
  /** A static asset served from `site/`, e.g. `scenarios.asset("hero.svg")`. */
  asset: (path: string): string => `/assets/${path}`,
} as const;
// #endregion

export type Scenarios = typeof scenarios;
