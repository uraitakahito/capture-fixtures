import { join } from "node:path";
import { Readable } from "node:stream";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import { BUILD_INFO } from "./generated/version.js";

const PLAIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><h1>ok</h1></body></html>`;
/**
 * A page the browser will revalidate on every visit.
 *
 * `no-cache` means "store it, but ask before reusing it" — so the second and
 * every later navigation sends `If-None-Match` and this route answers `304`,
 * which carries no body. That is the state BrowserHive's cache modes exist to
 * deal with, and nothing else in this fixture set can produce it: every other
 * route sends no validator at all, so Chromium has nothing to revalidate
 * against and never asks.
 *
 * Deliberately not `max-age`: a fresh entry is served from cache without
 * contacting the origin at all, which reports as a 200 and proves nothing.
 */
const CACHEABLE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>cacheable</title></head><body><h1>cacheable</h1></body></html>`;
const CACHEABLE_ETAG = '"meadow-cacheable-v1"';

const REDIRECT_TARGET_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>landed</title></head><body><h1>landed</h1></body></html>`;

// Client-side navigation on DOMContentLoaded. BrowserHive's runOnStableContext
// must survive the "Execution context was destroyed" this triggers.
const CLIENT_SIDE_REDIRECT_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>redirecting</title></head><body><script>location.replace("/redirect-target")</script></body></html>`;

// Below-the-fold lazy image + IntersectionObserver-swapped data-src. Only a
// browser that scrolls (autoScroll) will request /assets/hero.svg and /assets/below.svg.
/**
 * A page with no bottom.
 *
 * BrowserHive's `autoscroll` decides it has reached the end of a page by
 * scrolling, waiting 250ms and checking whether `scrollY` moved. So the page
 * has to have grown by then, every time — which is why the growing happens in
 * a `scroll` handler. Those run synchronously as the scroll is applied, so
 * they cannot be late.
 *
 * An `IntersectionObserver` would look far more like a real feed, and that is
 * exactly the trap: its callback is asynchronous, and a late one leaves
 * `scrollY` unchanged at the moment autoscroll looks. Autoscroll then reports
 * `reachedBottom: true` and the test that depends on this fixture goes red for
 * a reason that has nothing to do with what it is testing. A flaky fixture
 * gets a `retry` bolted on eventually, and then it is testing nothing.
 *
 * What is wanted here is not realism. It is the guarantee that the bottom is
 * never reached.
 */
const ENDLESS_FEED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>endless</title></head><body style="margin:0">
<div id="feed"></div>
<script>
var feed = document.getElementById("feed");
var screens = 0;
// Always keep three screens of runway below wherever we are. One would race
// the check outright; two still races it on the fractional final step.
function grow() {
  var want = window.scrollY + window.innerHeight * 3;
  while (feed.offsetHeight < want) {
    var s = document.createElement("div");
    s.style.height = "100vh";
    s.textContent = "screen " + (++screens);
    feed.appendChild(s);
  }
}
addEventListener("scroll", grow);
grow();
</script>
</body></html>`;

const LAZY_IMAGES_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>lazy</title></head><body>
<h1>top</h1>
<div style="height:3000px">scroll down</div>
<img loading="lazy" src="/assets/hero.svg" width="64" height="64" alt="lazy">
<img id="io" data-src="/assets/below.svg" width="64" height="64" alt="observed">
<script>
new IntersectionObserver((entries, obs) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      const img = e.target;
      img.src = img.dataset.src;
      obs.unobserve(img);
    }
  }
}).observe(document.getElementById("io"));
</script>
</body></html>`;

/**
 * Consent overlay that the heuristic pass of `dismissBanners` actually removes.
 *
 * The thresholds are the point. BrowserHive's second pass only removes an
 * element that is `position: fixed|sticky`, has a computed `z-index` of at
 * least 1000, and covers at least 30% of the viewport — the shape a real CMP
 * modal has, and narrow enough that page furniture survives.
 *
 * The earlier version of this fixture was a 16px-tall bottom bar with no
 * `z-index`. It matched none of those, so nothing ever removed it, and the
 * comment claiming it was "for dismissBanners to find and remove" was simply
 * untrue — nobody had checked, because no e2e sent `dismissBanners` at all.
 *
 * `#page-heading` stays outside the overlay so a test can tell "the banner was
 * removed" from "the whole page failed to render".
 */
const COOKIE_BANNER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>banner</title></head><body>
<h1 id="page-heading">content</h1>
<div id="cookie-banner" style="position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);color:#fff;padding:16px">
  We use cookies. <button onclick="document.getElementById('cookie-banner').remove()">Accept</button>
</div>
</body></html>`;

/**
 * Reports what the browser arrived carrying, then overwrites it with `?tag=`.
 *
 * ## Why a value, not a yes/no
 *
 * A shared browser context lives as long as the worker, so "the first visit
 * sees nothing" only holds on a freshly started stack — asserting it made the
 * suite pass once and fail on the second run. "The second visit sees the tag
 * the first visit wrote" holds however dirty the context already was.
 *
 * ## Why one JSON object, not one element per store
 *
 * Adding a store used to mean three edits: an element here, a line of script
 * here, and a regex in the consumer's test. With a single JSON payload the
 * consumer's reader never changes — a new store is one more key.
 *
 * ## Which store is which
 *
 *   cookie   — read server-side; it is HttpOnly, so the page cannot see it.
 *              Carried by the browser context.
 *   local    — localStorage. Carried by the browser context.
 *   session  — sessionStorage. Carried by the *tab*, which is why it is the
 *              only one of the three that can tell "same context" apart from
 *              "same tab".
 *
 * Rendered into `<pre id="arrival">` rather than a `<script type="application/json">`
 * so that opening the fixture in a browser by hand shows the payload directly.
 */
const cookieAndStorageHtml = (cookieTag: string, nextTag: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>state</title></head><body>
<pre id="arrival">pending</pre>
<script>
  // Adding a store means one more key here — and nothing at all in the consumer.
  var arrived = {
    cookie: ${JSON.stringify(cookieTag)},
    local: localStorage.getItem("meadow") ?? "fresh",
    session: sessionStorage.getItem("meadow") ?? "fresh"
  };
  document.getElementById("arrival").textContent = JSON.stringify(arrived);
  localStorage.setItem("meadow", ${JSON.stringify(nextTag)});
  sessionStorage.setItem("meadow", ${JSON.stringify(nextTag)});
</script>
</body></html>`;

/**
 * A page that fills both web storage areas until they total `bytes`.
 *
 * Splits the total evenly, one key per area, because each area carries its own
 * quota — see {@link scenarios.largeStorage} for why a single area cannot hold
 * enough to cross a consumer's ceiling.
 *
 * Reports what was **actually** stored rather than what was asked for. A quota
 * failure leaves values out of the archive, and so does a consumer's cap
 * working exactly as intended; a consumer that cannot tell those apart has a
 * test that passes whether or not the thing it tests is running. Reporting a
 * count instead of a yes/no follows `cookieAndStorageHtml`: the page states
 * what happened and lets the consumer decide what that means.
 */
const largeStorageHtml = (bytes: number): string => {
  const half = Math.floor(bytes / 2);
  return `<!doctype html><html><head><meta charset="utf-8"><title>large storage</title></head><body>
<pre id="stored">pending</pre>
<script>
  var key = "bulk";
  var fill = "a".repeat(Math.max(0, ${String(half)} - key.length));
  var stored = { local: 0, session: 0, errors: [] };
  [["local", localStorage], ["session", sessionStorage]].forEach(function (pair) {
    try {
      pair[1].setItem(key, fill);
      // Read back rather than trusting the write: the count is only evidence
      // if it comes from the area itself.
      stored[pair[0]] = key.length + (pair[1].getItem(key) || "").length;
    } catch (err) {
      stored.errors.push(pair[0] + ": " + (err && err.name ? err.name : String(err)));
    }
  });
  document.getElementById("stored").textContent = JSON.stringify(stored);
</script>
</body></html>`;
};

/**
 * The image variants a 1280px / DPR 1 capture never asks for.
 *
 * BrowserHive's `autofetch` exists to pull these in: at DPR 1 the browser picks
 * one candidate per element and never requests the rest, so a Retina replay
 * finds them missing. Until this page existed the behaviour had nothing to act
 * on — its e2e ran against `/plain-html`, which has no images at all, and could
 * only assert that autofetch had run, never what it fetched.
 *
 * One shape per element, so a failure names itself:
 *
 *   srcset       the classic 1x/2x/3x case
 *   picture      `<source>`, chosen by media query rather than DPR
 *   data-srcset  lazy variants, invisible until script rewrites them
 *   poster       the one that is not an `<img>` at all
 *
 * `hero.svg` is the control: the browser requests it unprompted, so a run where
 * only it arrives says "autofetch did not run", not "the page failed to load".
 *
 * **The media query must not match 1280px.** At `min-width: 2000px` the browser
 * can never choose `wide.svg`, so its arrival is proof that autofetch fetched
 * it. Lowering the threshold to something a 1280px viewport matches would let
 * the browser pick it unprompted and the downstream control would stop
 * discriminating — silently, since both runs would still be green.
 */
const RESPONSIVE_IMAGES_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>responsive</title></head><body>
<h1>responsive</h1>
<img src="/assets/hero.svg"
     srcset="/assets/hero.svg 1x, /assets/hero-2x.svg 2x, /assets/hero-3x.svg 3x"
     width="64" height="64" alt="srcset">
<picture>
  <source srcset="/assets/wide.svg" media="(min-width: 2000px)">
  <img src="/assets/narrow.svg" width="64" height="64" alt="picture">
</picture>
<img data-src="/assets/hero.svg" data-srcset="/assets/hero-2x.svg 2x"
     width="64" height="64" alt="lazy variants">
<video poster="/assets/poster.svg" width="64" height="64"></video>
</body></html>`;

/**
 * The crawl baseline: three same-origin links, plus one robots forbids.
 *
 * Every other `/links/*` page is this one with exactly one thing changed. That
 * is what makes the set discriminating — a crawler that follows nothing anywhere
 * is broken, and a crawler that follows everything everywhere is not applying
 * any rule. Only the difference between this page and its siblings separates the
 * two.
 *
 * `/links/hidden` is linked from here on purpose. A crawler has to reach this
 * page, see the link, and still not fetch it.
 */
const LINK_HUB_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>hub</title></head><body>
<h1>hub</h1>
<a href="/links/leaf/1">leaf 1</a>
<a href="/links/leaf/2">leaf 2</a>
<a href="/links/leaf/3">leaf 3</a>
<a href="/links/hidden">hidden</a>
</body></html>`;

/**
 * The hub with `rel="nofollow"` on the third link.
 *
 * The first two links are the control. Without them a crawler that failed to
 * parse the page at all would look exactly like one honouring `nofollow`.
 */
const LINK_NOFOLLOW_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>nofollow</title></head><body>
<h1>nofollow</h1>
<a href="/links/leaf/1">followed</a>
<a href="/links/leaf/2">followed</a>
<a href="/links/leaf/3" rel="nofollow">not followed</a>
</body></html>`;

/**
 * Links that leave the origin three different ways, with one control that does not.
 *
 * The foreign host is `.invalid` (RFC 2606) — guaranteed never to resolve. A
 * crawler that wrongly follows it fails against a name that cannot exist,
 * instead of reaching a stranger's server from someone's test suite.
 *
 * Port and scheme are here because "same origin" is scheme+host+port, and an
 * implementation comparing only the host passes a host-only test while being
 * wrong. The control link keeps the page from passing for a crawler that
 * follows nothing.
 */
const LINK_OFF_ORIGIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>off-origin</title></head><body>
<h1>off-origin</h1>
<a href="/links/leaf/1">same origin (control)</a>
<a href="http://elsewhere.invalid/page">different host</a>
<a href="http://localhost:9/page">different port</a>
<a href="https://localhost:8080/page">different scheme</a>
</body></html>`;

/**
 * One resource, spelled two ways.
 *
 * `#a` is a position inside a page, not another page. A crawler that keeps the
 * fragment captures `/links/leaf/1` twice — and the archive of a page captured
 * twice looks exactly like the archive of a page captured once.
 */
const LINK_FRAGMENTS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>fragments</title></head><body>
<h1>fragments</h1>
<a href="/links/leaf/1">plain</a>
<a href="/links/leaf/1#a">same page, different fragment</a>
</body></html>`;

/**
 * Three links that do not exist until script runs.
 *
 * **The served HTML contains no `<a` at all.** A consumer extracting links from
 * the response body finds none; one extracting from the rendered DOM finds
 * three. That difference is the whole scenario — it is the only page here that
 * can tell those two implementations apart.
 */
const LINK_JS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>js</title></head><body>
<h1>js</h1>
<div id="out"></div>
<script>
addEventListener("DOMContentLoaded", function () {
  var out = document.getElementById("out");
  for (var i = 1; i <= 3; i++) {
    var el = document.createElement("a");
    el.href = "/links/leaf/" + i;
    el.textContent = "leaf " + i;
    out.appendChild(el);
  }
});
</script>
</body></html>`;

/**
 * A link that appears `afterMs` after load — a deadline, not a race.
 *
 * `setTimeout`, deliberately. An `IntersectionObserver` or a `fetch` would make
 * the arrival depend on the consumer's own behaviour, and then a red test says
 * nothing about the consumer's deadline. Here the caller picks the moment: a
 * small `afterMs` asserts the link IS seen, a large one finds where looking stops.
 *
 * The page carries no link before the timer fires, so "not yet" and "never" are
 * the same observation — which is exactly the situation a consumer is in.
 */
const linkJsLateHtml = (afterMs: number): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>js-late</title></head><body>
<h1>js-late</h1>
<div id="out"></div>
<script>
setTimeout(function () {
  var el = document.createElement("a");
  el.href = "/links/leaf/1";
  el.textContent = "late";
  document.getElementById("out").appendChild(el);
}, ${String(afterMs)});
</script>
</body></html>`;

/**
 * One half of a two-page cycle.
 *
 * A crawler without dedupe walks `a` → `b` → `a` … until some other limit stops
 * it, and then reports **that** limit as why it stopped. The run looks orderly
 * and the reason is wrong.
 */
const linkCycleHtml = (side: string, other: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>cycle ${side}</title></head><body>
<h1>cycle ${side}</h1>
<a href="/links/cycle/${other}">to ${other}</a>
</body></html>`;

/**
 * `n` links on one page — the only generated page here.
 *
 * A page budget is the one link behaviour that needs more pages than a reader
 * would want written out, so this is the one place a count is a parameter rather
 * than a hand-written list.
 */
const linkFanOutHtml = (n: number): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>fan-out</title></head><body>
<h1>fan-out ${String(n)}</h1>
${Array.from({ length: n }, (_, i) => `<a href="/links/leaf/${String(i + 1)}">leaf ${String(i + 1)}</a>`).join("\n")}
</body></html>`;

/**
 * A page with no outbound links — where depth stops.
 *
 * The id changes the URL and nothing else. Distinct URLs are what depth and page
 * budgets are counted in; the body has no work to do beyond existing.
 */
const LINK_LEAF_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>leaf</title></head><body>
<h1>leaf</h1>
</body></html>`;

/** Reachable and linked from the hub, but forbidden by `/robots.txt`. */
const LINK_HIDDEN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>hidden</title></head><body>
<h1>hidden</h1>
</body></html>`;

/**
 * The only robots policy here.
 *
 * `Crawl-delay: 3` is chosen to be **longer** than a consumer would normally
 * space its own requests. A shorter value would be indistinguishable from being
 * ignored: the consumer's own spacing would dominate and the test would pass
 * whether or not robots was read at all.
 */
const ROBOTS_TXT = `User-agent: *
Crawl-delay: 3
Disallow: /links/hidden
`;

const FAILING_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>retry</title></head><body><h1>retry</h1></body></html>`;
const SUCCEEDED_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>ok</title></head><body><h1>ok</h1></body></html>`;

/**
 * Hold the page's main thread for `holdMs` at a time, repeating for
 * `repeatForMs`. While it is held nothing else in the page runs: `setTimeout`
 * callbacks cannot fire and `page.evaluate` cannot even start.
 *
 * This is the only way an origin can make a capture's per-operation budget
 * expire. A slow *response* (`/slow`) delays the navigation; it does not stop
 * the page from working once it has loaded.
 *
 * The holding starts from a `setTimeout`, not during parsing. Blocking the
 * parse would delay `DOMContentLoaded` itself, which pushes the cost onto the
 * navigation's 30s budget instead of the 5s budgets that guard the in-page
 * operations — a different thing entirely.
 */
const blockMainThreadHtml = (holdMs: number, repeatForMs: number): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>blocked</title></head><body><h1>blocked</h1>
<script>
const deadline = Date.now() + ${String(repeatForMs)};
const holdThread = () => {
  if (Date.now() >= deadline) { document.title = "unblocked"; return; }
  const until = Date.now() + ${String(holdMs)};
  while (Date.now() < until) { /* synchronous: nothing else in the page runs */ }
  setTimeout(holdThread, 0);
};
setTimeout(holdThread, 0);
</script>
</body></html>`;

/**
 * Ceiling for `repeatForMs`. A page that holds its thread forever survives the
 * capture that asked for it and wedges whatever runs next in the same tab.
 */
const MAX_REPEAT_FOR_MS = 30_000;
const MAX_DELAY_MS = 120_000;
const MAX_BODY_BYTES = 64 * 1024 * 1024;

/**
 * Ceiling for `/large-storage`, as a total across both areas.
 *
 * Deliberately not `MAX_BODY_BYTES`. A response body is limited by what the
 * socket will carry; web storage is limited by a per-area browser quota of
 * roughly 5 MiB, counted in UTF-16 code units. Half of this total lands in each
 * area, so 4 MiB here means 2 MiB of ASCII per area — 4 MiB of UTF-16, inside
 * the quota with room to spare. Allowing 64 MiB would let a caller ask for a
 * page that cannot exist and still get a 200 back, which is the failure mode
 * `numbers()` exists to prevent.
 */
const MAX_STORAGE_BYTES = 4 * 1024 * 1024;
/**
 * Ceiling for `/links/js-late`. Long enough to sit past any reasonable settle
 * window, short enough that a test asking for it still finishes.
 */
const MAX_AFTER_MS = 120_000;
/**
 * Ceiling for `/links/fan-out`. A page budget is the thing being exercised, and
 * budgets in the consumers here are tens, not thousands — a larger page would
 * only make the archive slow to produce and the failure slow to read.
 */
const MAX_FAN_OUT = 200;
/** Ceiling for `/links/leaf/:id`. Ids only have to outnumber `MAX_FAN_OUT`. */
const MAX_LEAF_ID = 200;
const MAX_HOPS = 20;
const MAX_FAIL_TIMES = 100;

/**
 * A JSON Schema for a set of integer parameters, each with a range.
 *
 * Every scenario knob is a bounded integer, and the point of bounding them is
 * that a fixture whose whole job is reproducing a failure must not answer "200,
 * quickly" when it cannot reproduce one. `Number("abc")` is `NaN`, `Number("")`
 * is `0`, and neither throws — so an unchecked knob turns a test asking for a
 * timeout into a test that passes for the wrong reason.
 *
 * Fastify coerces query and path strings to numbers from `type: "integer"`, so
 * handlers read numbers and a malformed value is a 400 before the handler runs.
 */
const numbers = (
  ranges: Record<string, [number, number]>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: "object",
  properties: Object.fromEntries(
    Object.entries(ranges).map(([name, [minimum, maximum]]) => [
      name,
      { type: "integer", minimum, maximum },
    ]),
  ),
  ...(required.length > 0 && { required }),
});

/** Trickle `bytes` bytes of "a" over roughly `overMs` milliseconds, in ~10 chunks. */
async function* slowBody(bytes: number, overMs: number): AsyncGenerator<Buffer> {
  const chunks = 10;
  const perChunk = Math.max(1, Math.ceil(bytes / chunks));
  const interval = Math.max(0, Math.floor(overMs / chunks));
  let remaining = bytes;
  while (remaining > 0) {
    const size = Math.min(perChunk, remaining);
    remaining -= size;
    if (interval > 0) await new Promise((resolve) => setTimeout(resolve, interval));
    yield Buffer.alloc(size, 0x61);
  }
}

/**
 * Build the fixture-origin Fastify app.
 *
 * Same core in two shapes: import it for in-process tests (via `app.inject`)
 * or run it in a container (`serve.ts`) so a worker's Chrome reaches it by IP.
 */
/**
 * One request as it arrived, for `/__requests`.
 *
 * A bounded set of headers, not all of them. Recording everything makes the
 * memory cost of a long-running dev container unpredictable, and an endpoint
 * that shows anything does not tell a reader what is worth looking at. When
 * something else turns out to be needed, adding it leaves a test explaining
 * why.
 */
export interface RecordedRequest {
  url: string;
  method: string;
  /**
   * The header that separates "the browser revalidated" from "the browser
   * fetched again" — and the reason this endpoint exists at all.
   */
  ifNoneMatch?: string;
  /** The same question for resources served without an `ETag`. */
  ifModifiedSince?: string;
  cacheControl?: string;
  acceptLanguage?: string;
}

/**
 * What `/__requests` returns.
 *
 * Deliberately NOT a way to count requests — use `/__request-counts` for that.
 * This log is capped, so counting it is right until the cap is reached and
 * quietly wrong afterwards. The two endpoints make different promises: counts
 * are exact and unbounded, this is the most recent `REQUEST_LOG_LIMIT`.
 */
export interface RequestLog {
  /** Arrival order. "The first was unconditional, the second was not" needs it. */
  requests: RecordedRequest[];
  /** True once the cap has dropped something. The log is no longer everything. */
  truncated: boolean;
}

/** How many requests `/__requests` keeps before dropping the oldest. */
export const REQUEST_LOG_LIMIT = 1000;

/** Headers worth keeping, and the field each lands in. */
const RECORDED_HEADERS = [
  ["if-none-match", "ifNoneMatch"],
  ["if-modified-since", "ifModifiedSince"],
  ["cache-control", "cacheControl"],
  ["accept-language", "acceptLanguage"],
] as const;

export function buildFixture(): FastifyInstance {
  const app = Fastify();

  // Per-URL request counter for retry/throughput assertions (/__request-counts).
  const hits = new Map<string, number>();
  // Per-key failure counter backing /fails-then-succeeds.
  const failureCounts = new Map<string, number>();
  // The last REQUEST_LOG_LIMIT requests, with headers (/__requests).
  const requests: RecordedRequest[] = [];
  let truncated = false;

  app.addHook("onRequest", (request, _reply, done) => {
    hits.set(request.url, (hits.get(request.url) ?? 0) + 1);

    // Introspection endpoints stay out of the log. Reading it must not change
    // what it says, or answering "was the second request conditional?" starts
    // with subtracting the reads.
    //
    // The counter above deliberately keeps counting them: it has always done
    // so, and tests are written against that.
    if (!request.url.startsWith("/__")) {
      if (requests.length >= REQUEST_LOG_LIMIT) {
        requests.shift();
        truncated = true;
      }
      const recorded: RecordedRequest = { url: request.url, method: request.method };
      for (const [header, field] of RECORDED_HEADERS) {
        const value = request.headers[header];
        if (typeof value === "string") recorded[field] = value;
      }
      requests.push(recorded);
    }
    done();
  });

  // Static assets (referenced by /lazy and available as /assets/*).
  void app.register(fastifyStatic, {
    root: join(import.meta.dirname, "..", "site"),
    prefix: "/assets/",
  });

  app.get("/health", () => ({ ok: true }));

  app.get("/plain-html", (_request, reply) => reply.type("text/html").send(PLAIN_HTML));
  app.get("/cacheable", (request, reply) => {
    reply.header("cache-control", "no-cache").header("etag", CACHEABLE_ETAG);
    // 304 carries no body by definition — that is the whole point of the
    // fixture, not an oversight.
    if (request.headers["if-none-match"] === CACHEABLE_ETAG) {
      return reply.code(304).send();
    }
    return reply.type("text/html").send(CACHEABLE_HTML);
  });

  app.get("/redirect-target", (_request, reply) => reply.type("text/html").send(REDIRECT_TARGET_HTML));
  app.get("/client-side-redirect", (_request, reply) => reply.type("text/html").send(CLIENT_SIDE_REDIRECT_HTML));
  app.get("/lazy-images", (_request, reply) => reply.type("text/html").send(LAZY_IMAGES_HTML));
  app.get("/endless-feed", (_request, reply) =>
    reply.type("text/html").send(ENDLESS_FEED_HTML));
  app.get("/cookie-banner", (_request, reply) => reply.type("text/html").send(COOKIE_BANNER_HTML));
  app.get("/responsive-images", (_request, reply) =>
    reply.type("text/html").send(RESPONSIVE_IMAGES_HTML));

  // Link scenarios. Each is /links/hub with exactly one thing changed, so a
  // crawler applying the wrong rule can be told apart from one that is broken.
  app.get("/links/hub", (_request, reply) => reply.type("text/html").send(LINK_HUB_HTML));
  app.get("/links/nofollow", (_request, reply) =>
    reply.type("text/html").send(LINK_NOFOLLOW_HTML));
  app.get("/links/off-origin", (_request, reply) =>
    reply.type("text/html").send(LINK_OFF_ORIGIN_HTML));
  app.get("/links/fragments", (_request, reply) =>
    reply.type("text/html").send(LINK_FRAGMENTS_HTML));
  app.get("/links/js", (_request, reply) => reply.type("text/html").send(LINK_JS_HTML));
  app.get("/links/hidden", (_request, reply) => reply.type("text/html").send(LINK_HIDDEN_HTML));

  // Served from a route rather than `site/`, which is mounted under /assets/.
  // A crawler asks for /robots.txt at the root or not at all.
  app.get("/robots.txt", (_request, reply) => reply.type("text/plain").send(ROBOTS_TXT));

  app.get<{ Querystring: { tag?: string } }>("/cookie-and-storage", (request, reply) => {
    const nextTag = request.query.tag ?? "notag";
    const arrived = /(?:^|;\s*)meadow=([A-Za-z0-9]+)/.exec(request.headers.cookie ?? "");
    return reply
      .header("set-cookie", `meadow=${nextTag}; Path=/; HttpOnly`)
      .type("text/html")
      .send(cookieAndStorageHtml(arrived?.[1] ?? "fresh", nextTag));
  });

  app.get<{ Querystring: { delayMs?: number } }>(
    "/slow-response",
    { schema: { querystring: numbers({ delayMs: [0, MAX_DELAY_MS] }) } },
    async (request, reply) => {
      const delayMs = request.query.delayMs ?? 35_000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return reply.type("text/html").send(`<!doctype html><h1>slept ${String(delayMs)}ms</h1>`);
    },
  );

  app.get<{ Querystring: { holdMs?: number; repeatForMs?: number } }>(
    "/block-main-thread",
    {
      // The ceiling lives in the schema, not in a Math.min below it. Two
      // ceilings for one value drift apart, and the one that loses is invisible.
      schema: {
        querystring: numbers({ holdMs: [0, MAX_REPEAT_FOR_MS], repeatForMs: [0, MAX_REPEAT_FOR_MS] }),
      },
    },
    (request, reply) => {
      const holdMs = request.query.holdMs ?? 1_000;
      const repeatForMs = request.query.repeatForMs ?? 10_000;
      return reply.type("text/html").send(blockMainThreadHtml(holdMs, repeatForMs));
    },
  );

  app.get<{ Params: { code: number } }>(
    "/http-status/:code",
    { schema: { params: numbers({ code: [100, 599] }, ["code"]) } },
    (request, reply) => {
      const code = request.params.code;
      return reply.code(code).type("text/html").send(`<!doctype html><h1>${String(code)}</h1>`);
    },
  );

  app.get<{ Params: { hops: number } }>(
    "/server-redirect-chain/:hops",
    { schema: { params: numbers({ hops: [0, MAX_HOPS] }, ["hops"]) } },
    (request, reply) => {
      const hops = request.params.hops;
      const target = hops > 0 ? `/server-redirect-chain/${String(hops - 1)}` : "/redirect-target";
      return reply.redirect(target, 302);
    },
  );

  app.get<{ Params: { id: number } }>(
    "/links/leaf/:id",
    { schema: { params: numbers({ id: [1, MAX_LEAF_ID] }, ["id"]) } },
    (_request, reply) => reply.type("text/html").send(LINK_LEAF_HTML),
  );

  app.get<{ Querystring: { afterMs?: number } }>(
    "/links/js-late",
    { schema: { querystring: numbers({ afterMs: [0, MAX_AFTER_MS] }) } },
    (request, reply) => {
      const afterMs = request.query.afterMs ?? 5_000;
      return reply.type("text/html").send(linkJsLateHtml(afterMs));
    },
  );

  app.get<{ Params: { side: string } }>(
    "/links/cycle/:side",
    {
      // Not `numbers()` — the knob is a name, not a count. Anything but the two
      // sides is a 404 rather than a page linking somewhere that does not exist.
      schema: { params: { type: "object", properties: { side: { type: "string", enum: ["a", "b"] } }, required: ["side"] } },
    },
    (request, reply) => {
      const side = request.params.side;
      return reply.type("text/html").send(linkCycleHtml(side, side === "a" ? "b" : "a"));
    },
  );

  app.get<{ Querystring: { n?: number } }>(
    "/links/fan-out",
    { schema: { querystring: numbers({ n: [0, MAX_FAN_OUT] }) } },
    (request, reply) => {
      const n = request.query.n ?? 10;
      return reply.type("text/html").send(linkFanOutHtml(n));
    },
  );

  app.get<{ Querystring: { bytes?: number } }>(
    "/large-body",
    { schema: { querystring: numbers({ bytes: [0, MAX_BODY_BYTES] }) } },
    (request, reply) => {
      const bytes = request.query.bytes ?? 1_048_576;
      return reply.type("text/plain").send("a".repeat(bytes));
    },
  );

  app.get<{ Querystring: { bytes?: number } }>(
    "/large-storage",
    { schema: { querystring: numbers({ bytes: [0, MAX_STORAGE_BYTES] }) } },
    (request, reply) => {
      const bytes = request.query.bytes ?? 3_145_728;
      return reply.type("text/html").send(largeStorageHtml(bytes));
    },
  );

  app.get<{ Querystring: { bytes?: number; overMs?: number } }>(
    "/slow-body",
    {
      schema: {
        querystring: numbers({ bytes: [0, MAX_BODY_BYTES], overMs: [0, MAX_DELAY_MS] }),
      },
    },
    (request, reply) => {
      const bytes = request.query.bytes ?? 65_536;
      const overMs = request.query.overMs ?? 5_000;
      return reply.type("text/plain").send(Readable.from(slowBody(bytes, overMs)));
    },
  );

  app.get<{ Querystring: { failTimes?: number; key?: string } }>(
    "/fails-then-succeeds",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            failTimes: { type: "integer", minimum: 0, maximum: MAX_FAIL_TIMES },
            key: { type: "string" },
          },
        },
      },
    },
    (request, reply) => {
      const key = request.query.key ?? "default";
      const failTimes = request.query.failTimes ?? 2;
      const n = (failureCounts.get(key) ?? 0) + 1;
      failureCounts.set(key, n);
      if (n <= failTimes) return reply.code(503).type("text/html").send(FAILING_HTML);
      return reply.type("text/html").send(SUCCEEDED_HTML);
    },
  );

  // Test-only introspection: read counters, reset all in-memory state.
  app.get("/__request-counts", () => Object.fromEntries(hits));
  app.get("/__requests", (): RequestLog => ({ requests, truncated }));
  app.post("/__reset", () => {
    hits.clear();
    failureCounts.clear();
    requests.length = 0;
    truncated = false;
    return { ok: true };
  });

  // Which build is answering. Deliberately not folded into /health: that
  // question is "are you up", asked in a tight loop by readiness waits, and it
  // should keep answering only that. This one is asked when a test fails for
  // no visible reason and you start wondering whether the container in front
  // of you was ever rebuilt.
  app.get("/__version", () => BUILD_INFO);

  return app;
}
