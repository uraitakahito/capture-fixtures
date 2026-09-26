import type { AddressInfo } from "node:net";
import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture, REQUEST_LOG_LIMIT, type RequestLog } from "../src/fixture.js";
import { MARKED_KINDS, markedTokens } from "../src/marked.js";
import { scenarios } from "../src/scenarios.js";
import { fetchOk } from "./helpers.js";

let app: ReturnType<typeof buildFixture>;

beforeEach(() => {
  app = buildFixture();
});

afterEach(async () => {
  await app.close();
});

describe("static pages", () => {
  it("/health returns ok", async () => {
    const res = await fetchOk(app, "/health");
    expect(res.json()).toEqual({ ok: true });
  });

  it("/plain-html returns 200 HTML", async () => {
    const res = await fetchOk(app, "/plain-html");
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<h1>ok</h1>");
  });

  it("/client-side-redirect ships a client-side location.replace", async () => {
    const res = await fetchOk(app, "/client-side-redirect");
    expect(res.body).toContain('location.replace("/redirect-target")');
  });

  it("/lazy-images has a below-the-fold lazy image", async () => {
    const res = await fetchOk(app, "/lazy-images");
    expect(res.body).toContain('loading="lazy"');
    expect(res.body).toContain("/assets/hero.svg");
  });

  it("/endless-feed grows itself from a scroll handler, not an observer", async () => {
    const res = await app.inject("/endless-feed");

    expect(res.statusCode).toBe(200);
    // The distinction this fixture exists for. A scroll handler runs
    // synchronously with the scroll, so the page has always grown by the time
    // BrowserHive's autoscroll checks whether `scrollY` moved. An
    // IntersectionObserver callback can be late, and a late one makes
    // autoscroll report that it reached the bottom of a page that has none.
    expect(res.body).toContain('addEventListener("scroll"');
    expect(res.body).not.toContain("IntersectionObserver");
    // Runway, so growing never races the check. Verified against a real
    // capture in browserhive's e2e; reducing it there turns that test red.
    expect(res.body).toContain("window.innerHeight * 3");
  });

  it("/cookie-banner has a fixed cookie overlay", async () => {
    const res = await fetchOk(app, "/cookie-banner");
    expect(res.body).toContain("cookie-banner");
  });

  it("/responsive-images offers variants the browser will not pick at DPR 1", async () => {
    const res = await fetchOk(app, "/responsive-images");

    // The four shapes autofetch looks for. Each is a separate element so a
    // downstream failure names which one was missed.
    expect(res.body).toContain(`srcset="/assets/hero.svg 1x`);
    expect(res.body).toContain("data-srcset=");
    expect(res.body).toContain("<source");
    expect(res.body).toContain(`poster="/assets/poster.svg"`);

    // **The threshold is load-bearing.** The capture viewport is 1280px, so a
    // media query the browser could match would let it choose wide.svg itself
    // — and the downstream control ("autofetch off ⇒ wide.svg absent") would
    // stop discriminating while staying green.
    expect(res.body).toContain("min-width: 2000px");

    // The control: requested unprompted, so its absence means the page broke
    // rather than that autofetch was off.
    expect(res.body).toContain(`src="/assets/hero.svg"`);
  });

  // A page referencing an asset that 404s would make the downstream assertion
  // fail for the wrong reason — "autofetch did not fetch it" instead of
  // "the fixture cannot serve it".
  it.each(["hero.svg", "below.svg", "hero-2x.svg", "hero-3x.svg", "wide.svg", "narrow.svg", "poster.svg"])(
    "serves /assets/%s",
    async (name) => {
      await fetchOk(app, `/assets/${name}`);
    },
  );

  it("/cookie-and-storage sets a cookie header", async () => {
    const res = await fetchOk(app, "/cookie-and-storage");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("/cookie-and-storage reports every store it writes", async () => {
    // The point of this fixture is that a consumer can read one payload and
    // learn about all three stores. If a store is written but not reported —
    // or reported but not written — the consumer sees a green test that is
    // measuring nothing. Name both halves here.
    const res = await fetchOk(app, "/cookie-and-storage?tag=probe");

    expect(res.body).toContain('id="arrival"');
    for (const key of ["cookie:", "local:", "session:"]) {
      expect(res.body).toContain(key);
    }
    expect(res.body).toContain("localStorage.setItem");
    expect(res.body).toContain("sessionStorage.setItem");
  });
});

describe("controllable responses", () => {
  it("/slow waits the requested time then responds", async () => {
    const res = await app.inject("/slow-response?delayMs=5");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("slept 5ms");
  });

  it("/http-status/:code returns that status", async () => {
    expect((await app.inject("/http-status/503")).statusCode).toBe(503);
    expect((await app.inject("/http-status/404")).statusCode).toBe(404);
    expect((await app.inject("/http-status/204")).statusCode).toBe(204);
  });

  it("/server-redirect-chain/:n chains 302s down to /landed", async () => {
    const two = await app.inject("/server-redirect-chain/2");
    expect(two.statusCode).toBe(302);
    expect(two.headers.location).toBe("/server-redirect-chain/1");

    const zero = await app.inject("/server-redirect-chain/0");
    expect(zero.statusCode).toBe(302);
    expect(zero.headers.location).toBe("/redirect-target");
  });

  it("/big returns a body of the requested size", async () => {
    const res = await fetchOk(app, "/large-body?bytes=100");
    expect(res.rawPayload.length).toBe(100);
  });

  it("/slow-body trickles the requested number of bytes", async () => {
    const res = await fetchOk(app, "/slow-body?bytes=50&overMs=0");
    expect(res.rawPayload.length).toBe(50);
  });

  /**
   * Runs the page's own script against a fake storage rather than matching its
   * text. Only a browser can fill real storage, but the logic that decides
   * *what* to write — and what to report when a write fails — is plain
   * JavaScript, and asserting on the source instead lets a defect through: the
   * string `errors` survives deleting the code that fills it.
   */
  const runStoragePage = (
    html: string,
    { quota = Infinity, truncateTo = Infinity }: { quota?: number; truncateTo?: number } = {},
  ): { local: number; session: number; errors: string[] } => {
    const area = (): Storage => {
      const held = new Map<string, string>();
      return {
        setItem(key: string, value: string) {
          if (key.length + value.length > quota) {
            const err = new Error("quota");
            err.name = "QuotaExceededError";
            throw err;
          }
          // Some storage implementations keep less than they were handed
          // without saying so; that is what the page's read-back is for.
          held.set(key, value.slice(0, truncateTo));
        },
        getItem: (key: string) => held.get(key) ?? null,
      } as unknown as Storage;
    };
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
    if (script === undefined) throw new Error("the page carries no script");
    const el = { textContent: "" };
    runInNewContext(script, {
      localStorage: area(),
      sessionStorage: area(),
      document: { getElementById: () => el },
    });
    return JSON.parse(el.textContent) as { local: number; session: number; errors: string[] };
  };

  it("/large-storage splits the requested total between the two areas", async () => {
    const res = await fetchOk(app, "/large-storage?bytes=2048");
    const stored = runStoragePage(res.body);
    // Half each, not the whole total in one: a single area cannot hold enough
    // to cross a consumer's ceiling before the browser's own quota stops it.
    expect(stored).toEqual({ local: 1024, session: 1024, errors: [] });
  });

  it("/large-storage reports a write it could not make", async () => {
    const res = await fetchOk(app, "/large-storage?bytes=2048");
    const stored = runStoragePage(res.body, { quota: 100 });
    // Silence here would be indistinguishable from a consumer's cap working.
    expect(stored.errors).toEqual([
      "local: QuotaExceededError",
      "session: QuotaExceededError",
    ]);
    expect(stored.local).toBe(0);
    expect(stored.session).toBe(0);
  });

  it("/large-storage counts what the area kept, not what it was handed", async () => {
    const res = await fetchOk(app, "/large-storage?bytes=2048");
    // A write that quietly keeps less than it was given raises no error, so the
    // only way to notice is to ask the area. Reporting `fill.length` instead
    // would claim 1024 here and the consumer would measure its cap against a
    // number no storage ever held.
    const stored = runStoragePage(res.body, { truncateTo: 300 });
    expect(stored).toEqual({ local: 304, session: 304, errors: [] });
  });
});

describe("stateful fails-then-succeeds", () => {
  it("fails `fail` times then succeeds, per key", async () => {
    const url = "/fails-then-succeeds?failTimes=2&key=t1";
    expect((await app.inject(url)).statusCode).toBe(503);
    expect((await app.inject(url)).statusCode).toBe(503);
    expect((await app.inject(url)).statusCode).toBe(200);
  });

  it("isolates counters between keys", async () => {
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=a")).statusCode).toBe(503);
    // Different key starts fresh, so it is still on its first (failing) request.
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=b")).statusCode).toBe(503);
    // `a` has now had its one failure and succeeds.
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=a")).statusCode).toBe(200);
  });
});

describe("introspection", () => {
  it("/__request-counts counts requests per URL", async () => {
    await fetchOk(app, "/plain-html");
    await fetchOk(app, "/plain-html");
    await fetchOk(app, "/redirect-target");
    const hits = (await fetchOk(app, "/__request-counts")).json<Record<string, number>>();
    expect(hits["/plain-html"]).toBe(2);
    expect(hits["/redirect-target"]).toBe(1);
  });

  it("/__requests records whether a request was conditional", async () => {
    // The whole reason this exists. /__request-counts can say a URL was asked
    // for twice; it cannot say the second ask carried If-None-Match, which is
    // the only thing that distinguishes "the browser revalidated" from "the
    // browser fetched again".
    const first = await app.inject("/cacheable");
    const etag = first.headers.etag!;
    await app.inject({ url: "/cacheable", headers: { "if-none-match": etag } });

    const log = (await fetchOk(app, "/__requests")).json<RequestLog>();

    // Arrival order matters as much as the contents: the statement being made
    // is "the first was unconditional and the second was not".
    expect(log.requests).toHaveLength(2);
    expect(log.requests[0]?.url).toBe("/cacheable");
    expect(log.requests[0]?.ifNoneMatch).toBeUndefined();
    expect(log.requests[1]?.ifNoneMatch).toBe(etag);
    expect(log.truncated).toBe(false);
  });

  it("/__requests keeps the headers that explain caching, and not every header", async () => {
    await app.inject({
      url: "/plain-html",
      headers: {
        "accept-language": "ja-JP,ja;q=0.9",
        "cache-control": "no-cache",
        "if-modified-since": "Sun, 02 Aug 2026 00:00:00 GMT",
        // Deliberately not recorded: a bounded set is what keeps the memory
        // cost of a long-running dev container predictable.
        cookie: "session=secret",
      },
    });

    const log = (await fetchOk(app, "/__requests")).json<RequestLog>();
    const only = log.requests[0];

    expect(only?.acceptLanguage).toBe("ja-JP,ja;q=0.9");
    expect(only?.cacheControl).toBe("no-cache");
    expect(only?.ifModifiedSince).toBe("Sun, 02 Aug 2026 00:00:00 GMT");
    expect(only?.method).toBe("GET");
    expect(Object.keys(only ?? {})).not.toContain("cookie");
  });

  it("/__requests keeps the Host, the name a request came in under", async () => {
    // Two instances of this fixture are two sites to a browser only because
    // their names differ. The Host is what shows which one served an iframe.
    await app.inject({ url: "/plain-html", headers: { host: "capture-fixtures-b.example:8080" } });

    const log = (await fetchOk(app, "/__requests")).json<RequestLog>();
    expect(log.requests[0]?.host).toBe("capture-fixtures-b.example:8080");
  });

  it("/__requests does not record the introspection endpoints themselves", async () => {
    // Looking at the log must not change what the log says. Otherwise reading
    // "was the second request conditional?" means first subtracting the reads.
    await fetchOk(app, "/plain-html");
    await app.inject("/__requests");
    await app.inject("/__request-counts");

    const log = (await fetchOk(app, "/__requests")).json<RequestLog>();
    expect(log.requests.map((r) => r.url)).toEqual(["/plain-html"]);
  });

  it("/__requests drops the oldest once the limit is hit, and says it did", async () => {
    // The limit exists so a dev container running for days cannot grow without
    // bound. `truncated` exists so nobody counts a truncated log and believes
    // the number.
    for (let i = 0; i <= REQUEST_LOG_LIMIT; i++) {
      await app.inject(`/plain-html?i=${String(i)}`);
    }

    const log = (await fetchOk(app, "/__requests")).json<RequestLog>();
    expect(log.truncated).toBe(true);
    expect(log.requests).toHaveLength(REQUEST_LOG_LIMIT);
    expect(log.requests[0]?.url).not.toContain("i=0");
  });

  it("/__reset clears the request log as well", async () => {
    await fetchOk(app, "/plain-html");
    await app.inject({ method: "POST", url: "/__reset" });

    const log = (await fetchOk(app, "/__requests")).json<RequestLog>();
    expect(log).toEqual({ requests: [], truncated: false });
  });

  it("/__reset clears counters and failure state", async () => {
    // The first hit on a fresh key is meant to fail — that is the scenario.
    await fetchOk(app, "/fails-then-succeeds?failTimes=1&key=r", 503);
    await fetchOk(app, "/plain-html");
    const reset = await app.inject({ method: "POST", url: "/__reset" });
    expect(reset.statusCode).toBe(200);

    // Counters gone (only this /__request-counts request is counted now).
    const hits = (await fetchOk(app, "/__request-counts")).json<Record<string, number>>();
    expect(hits["/plain-html"]).toBeUndefined();
    // Flaky counter reset, so key=r fails again on its fresh first request.
    expect((await app.inject("/fails-then-succeeds?failTimes=1&key=r")).statusCode).toBe(503);
  });
});

describe("block-main-thread", () => {
  it("embeds both durations", async () => {
    const res = await app.inject("/block-main-thread?holdMs=6000&repeatForMs=20000");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Date.now() + 20000");
    expect(res.body).toContain("Date.now() + 6000");
  });

  it("does not block parsing — the holding starts from a setTimeout", async () => {
    // If this regresses, the cost lands on the consumer's navigation budget
    // instead of its in-page operation budgets, and the scenario silently
    // stops testing what it exists to test.
    const res = await fetchOk(app, "/block-main-thread");
    expect(res.body).toContain("setTimeout(holdThread, 0);\n</script>");
  });

  // The cap used to clamp silently: repeatForMs=999999 became 30000 and the
  // caller was told nothing. Rounding a request into a different request is the
  // same failure this fixture exists to avoid — a scenario that quietly is not
  // the scenario that was asked for. Over the ceiling is now a 400.
  it("refuses a repeatForMs above the ceiling instead of rounding it", async () => {
    const res = await app.inject("/block-main-thread?repeatForMs=999999");
    expect(res.statusCode).toBe(400);
  });

  it("still accepts repeatForMs at the ceiling", async () => {
    const res = await fetchOk(app, "/block-main-thread?repeatForMs=30000");
    expect(res.body).toContain("Date.now() + 30000");
  });
});

describe("settle signals", () => {
  let app: ReturnType<typeof buildFixture>;
  beforeEach(() => {
    app = buildFixture();
  });
  afterEach(async () => {
    await app.close();
  });

  it("/fetch-late は呼ぶ側の 2 つの時間で fetch を出し、DOM には触らない", async () => {
    const res = await fetchOk(app, "/fetch-late?afterMs=100&takesMs=2500");
    expect(res.body).toContain('fetch("/slow-response?delayMs=2500")');
    expect(res.body).toContain("}, 100);");
    // The network is the only late thing here. A page that also wrote to the
    // DOM would let a DOM-quiet consumer pass for the wrong reason.
    expect(res.body).not.toContain("document.");
    expect(res.body).not.toContain("<a ");
  });

  it("/fetch-late の既定は 5 秒の fetch を読み込み直後に出す", async () => {
    const res = await fetchOk(app, "/fetch-late");
    expect(res.body).toContain('fetch("/slow-response?delayMs=5000")');
    expect(res.body).toContain("}, 0);");
  });

  it("/ticker は periodMs ごとに時計を書き換え、forMs で自分から止まる", async () => {
    const res = await fetchOk(app, "/ticker?periodMs=40&forMs=900");
    expect(res.body).toContain("Date.now() + 900");
    expect(res.body).toContain("setTimeout(tick, 40);");
    expect(res.body).toContain('clock.textContent = String(Date.now());');
    // Nothing is fetched: the network must be quiet so that only the DOM signal
    // can hold a consumer's wait open.
    expect(res.body).not.toContain("fetch(");
    expect(res.body).not.toContain("setInterval");
  });

  it("/ticker の既定は 250 ms ごと、上限の 30 秒まで", async () => {
    const res = await fetchOk(app, "/ticker");
    expect(res.body).toContain("Date.now() + 30000");
    expect(res.body).toContain("setTimeout(tick, 250);");
  });
});

describe("__version", () => {
  it("reports the three fields it exists to report", async () => {
    const res = await app.inject("/__version");
    expect(res.statusCode).toBe(200);
    // The values move with every build, so only the shape is pinned here.
    // Asserting the contents would turn this into a test of
    // generate-version.mjs, which is a different thing entirely.
    const body = res.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(["buildTime", "revision", "version"]);
    for (const [field, value] of Object.entries(body)) {
      expect(typeof value, field).toBe("string");
    }
  });

  it("leaves /health answering only whether it is up", async () => {
    // The split is the point of having two routes. Readiness waits poll
    // /health in a tight loop and should keep getting one small answer.
    expect((await app.inject("/health")).json()).toEqual({ ok: true });
  });
});

describe("static assets", () => {
  it("serves /assets/hero.svg", async () => {
    const res = await app.inject("/assets/hero.svg");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg");
  });
});

/**
 * Malformed knobs are refused, not silently reinterpreted.
 *
 * `Number("abc")` is `NaN` and `Number("")` is `0`, and neither throws. Before
 * these schemas, `?delayMs=abc` answered 200 in ~2ms — a consumer asking for a
 * timeout got a fast success and its test passed for the wrong reason. That is
 * the worst thing a fixture can do, so each knob now has a range and anything
 * outside it is a 400 before the handler runs.
 */
describe("link scenarios", () => {
  let app: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    app = buildFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  it("/links/hub links to three leaves and to the page robots forbids", async () => {
    const res = await fetchOk(app, "/links/hub");

    // The baseline every other link page is a variation of.
    for (const id of [1, 2, 3]) {
      expect(res.body).toContain(`href="/links/leaf/${String(id)}"`);
    }
    // Linked on purpose: a crawler has to reach the page, see this, and still
    // not fetch it. A hidden page nobody links to proves nothing.
    expect(res.body).toContain('href="/links/hidden"');
  });

  it("/links/nofollow marks only the third link", async () => {
    const res = await fetchOk(app, "/links/nofollow");

    // Two unmarked links are the control. Without them, a crawler that failed
    // to parse the page would be indistinguishable from one honouring nofollow.
    expect(res.body).toContain('href="/links/leaf/1">');
    expect(res.body).toContain('href="/links/leaf/2">');
    expect(res.body).toContain('href="/links/leaf/3" rel="nofollow"');
    expect(res.body.match(/rel="nofollow"/g)).toHaveLength(1);
  });

  it("/links/off-origin leaves the origin by host, port and scheme", async () => {
    const res = await fetchOk(app, "/links/off-origin");

    // Same origin is scheme+host+port, so a crawler comparing only the host
    // passes a host-only page while being wrong. All three are here.
    expect(res.body).toContain('href="http://elsewhere.invalid/page"');
    expect(res.body).toContain('href="http://localhost:9/page"');
    expect(res.body).toContain('href="https://localhost:8080/page"');
    // The control, so the page cannot pass for a crawler that follows nothing.
    expect(res.body).toContain('href="/links/leaf/1"');
  });

  it("/links/fragments spells one resource two ways", async () => {
    const res = await fetchOk(app, "/links/fragments");
    expect(res.body).toContain('href="/links/leaf/1"');
    expect(res.body).toContain('href="/links/leaf/1#a"');
  });

  it("/links/js serves no anchor at all — the links are built by script", async () => {
    const res = await fetchOk(app, "/links/js");

    // The whole point. A consumer reading the response body finds nothing; one
    // reading the rendered DOM finds three. This assertion is what keeps the
    // page able to tell those apart — an anchor slipping into the HTML would
    // make it pass for both.
    expect(res.body).not.toContain("<a ");
    expect(res.body).toContain('createElement("a")');
  });

  it("/links/js-late puts the caller's deadline in the timer", async () => {
    const res = await fetchOk(app, "/links/js-late?afterMs=250");
    expect(res.body).not.toContain("<a ");
    expect(res.body).toContain("}, 250);");
    // A deadline the caller chose, not a callback that may be late.
    expect(res.body).not.toContain("IntersectionObserver");
  });

  it("/links/cycle/:side points at the other side", async () => {
    const a = await fetchOk(app, "/links/cycle/a");
    expect(a.body).toContain('href="/links/cycle/b"');

    const b = await fetchOk(app, "/links/cycle/b");
    expect(b.body).toContain('href="/links/cycle/a"');
  });

  it("/links/fan-out serves exactly n links", async () => {
    const res = await fetchOk(app, "/links/fan-out?n=7");
    expect(res.body.match(/<a href=/g)).toHaveLength(7);
  });

  it("/links/leaf/:id is a dead end", async () => {
    const res = await fetchOk(app, "/links/leaf/1");
    // Depth has to stop somewhere, and this is where.
    expect(res.body).not.toContain("<a ");
  });

  it("/robots.txt forbids the hidden page and asks for a delay that can be seen", async () => {
    const res = await fetchOk(app, "/robots.txt");

    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("Disallow: /links/hidden");
    // 3s, not 1s. A delay shorter than a consumer's own spacing is
    // indistinguishable from being ignored — the consumer's value would
    // dominate and the test would pass either way.
    expect(res.body).toContain("Crawl-delay: 3");
  });

  it("/links/hidden is served — robots is the only thing keeping it out", async () => {
    // If the page 404'd, a crawler that ignores robots would also fail to fetch
    // it, and the scenario would pass for the wrong reason.
    await fetchOk(app, "/links/hidden");
  });
});

describe("pages a consumer must not keep", () => {
  /** Anything that looks like a token, whichever page it came from. */
  const TOKEN = /(?:title|text|link)-[a-z0-9-]+/;

  /** Every URL a page points at: its attributes and its script's fetch. */
  const urlsIn = (html: string): string[] => [
    ...[...html.matchAll(/(?:src|href)="([^"]*)"/g)].map((m) => m[1] ?? ""),
    ...[...html.matchAll(/fetch\("([^"]*)"\)/g)].map((m) => m[1] ?? ""),
  ];

  it("/marked/page/:name writes each token into the page and none into a URL", async () => {
    const res = await fetchOk(app, scenarios.markedPage("secret", "t1"));
    const t = markedTokens("secret", "t1");

    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain(`<title>${t.title}</title>`);
    expect(res.body).toContain(`<p id="text">${t.text}</p>`);
    expect(res.body).toContain(`>${t.link}</a>`);
    // The design in one assertion. A URL reaches an archive's index whether or
    // not the page was kept, so a token in one would be found in every archive
    // and a consumer's "nothing survived" test could never pass.
    const urls = urlsIn(res.body);
    expect(urls).toHaveLength(3);
    for (const url of urls) expect(url).not.toMatch(TOKEN);
  });

  it("/marked/page/:name loads the assets the contract names", async () => {
    const res = await fetchOk(app, scenarios.markedPage("secret", "t1"));
    // Entity-encoded in the attribute, bare in the script. Both have to decode
    // to the URL a consumer looks for in the request log.
    const pixel = scenarios.markedAsset("pixel.svg", "secret", "t1").replace("&", "&amp;");
    expect(res.body).toContain(`src="${pixel}"`);
    expect(res.body).toContain(`fetch("${scenarios.markedAsset("data.json", "secret", "t1")}")`);
  });

  it("name changes the URL and nothing else", async () => {
    const a = await fetchOk(app, scenarios.markedPage("alpha", "t1"));
    const b = await fetchOk(app, scenarios.markedPage("bravo", "t1"));
    // What lets a policy aimed at one name leave the other as the control.
    expect(a.body.replaceAll("alpha", "NAME")).toBe(b.body.replaceAll("bravo", "NAME"));
  });

  it("embed puts the other page in an iframe, and only when asked", async () => {
    const alone = await fetchOk(app, scenarios.markedPage("public", "t1"));
    expect(alone.body).not.toContain("<iframe");

    const res = await fetchOk(app, scenarios.markedPage("public", "t1", "secret"));
    expect(res.body).toContain('<iframe src="/marked/page/secret?tag=t1"');
    // The embedded page's tokens are not in the embedding page's HTML. A
    // consumer ends up with them only by keeping something of the iframe.
    expect(res.body).not.toContain(markedTokens("secret", "t1").text);
  });

  it("embedOrigin serves the iframe from another origin, and moves nothing else", async () => {
    const origin = "http://capture-fixtures-b.example:8080";
    const here = await fetchOk(app, scenarios.markedPage("public", "t1", "secret"));
    const there = await fetchOk(app, scenarios.markedPage("public", "t1", "secret", { embedOrigin: origin }));
    expect(there.body).toContain(`<iframe src="${origin}/marked/page/secret?tag=t1"`);
    // The page's own image and fetch stay on this origin: take the origin out
    // of the iframe and the two pages are the same.
    expect(there.body.replace(origin, "")).toBe(here.body);
  });

  it("/marked/text/:name serves the same tokens as text/plain", async () => {
    const res = await fetchOk(app, scenarios.markedText("secret", "t1"));
    const t = markedTokens("secret", "t1");
    expect(res.headers["content-type"]).toContain("text/plain");
    for (const token of [t.title, t.text, t.link]) expect(res.body).toContain(token);
  });

  it("/marked/server-redirect/:hops/:name redirects exactly hops times, then to the page", async () => {
    let url = scenarios.markedServerRedirect(3, "secret", "t1");
    const hops: string[] = [];
    for (;;) {
      const res = await app.inject(url);
      if (res.statusCode !== 302) {
        expect(res.statusCode, url).toBe(200);
        break;
      }
      url = String(res.headers.location);
      hops.push(url);
    }
    expect(hops).toEqual([
      "/marked/server-redirect/2/secret?tag=t1",
      "/marked/server-redirect/1/secret?tag=t1",
      scenarios.markedPage("secret", "t1"),
    ]);
  });

  it("/marked/script-redirect/:name sends the browser to the page and carries no token", async () => {
    const res = await fetchOk(app, scenarios.markedScriptRedirect("secret", "t1"));
    expect(res.body).toContain(`location.replace("${scenarios.markedPage("secret", "t1")}")`);
    expect(res.body).not.toMatch(TOKEN);
  });

  it("the assets and the leaf carry no token", async () => {
    const pixel = await fetchOk(app, scenarios.markedAsset("pixel.svg", "secret", "t1"));
    expect(pixel.headers["content-type"]).toContain("image/svg+xml");
    const data = await fetchOk(app, scenarios.markedAsset("data.json", "secret", "t1"));
    expect(data.headers["content-type"]).toContain("application/json");
    const leaf = await fetchOk(app, "/marked/leaf?tag=t1");
    for (const res of [pixel, data, leaf]) expect(res.body).not.toMatch(TOKEN);
  });

  it("/marked/popup/:name opens the marked page in a new window and carries no token", async () => {
    const res = await fetchOk(app, scenarios.markedPopup("secret", "t1"));
    expect(res.body).toContain(`window.open("${scenarios.markedPage("secret", "t1")}", "_blank")`);
    expect(res.body).not.toMatch(TOKEN);
  });

  it("/marked/worker/:name starts a worker whose own fetch asks for data.json as <name>-worker", async () => {
    const page = await fetchOk(app, scenarios.markedWorker("public", "t1"));
    expect(page.body).toContain(`new Worker("${scenarios.markedAsset("worker.js", "public", "t1")}")`);
    const script = await fetchOk(app, scenarios.markedAsset("worker.js", "public", "t1"));
    expect(script.headers["content-type"]).toContain("javascript");
    // Run the script as the worker would, at the URL it was loaded from, and
    // see what it asks for.
    const asked: string[] = [];
    runInNewContext(script.body, {
      self: { location: new URL(`http://fixture${scenarios.markedAsset("worker.js", "public", "t1")}`) },
      URLSearchParams,
      fetch: (url: string) => asked.push(url),
    });
    expect(asked).toEqual([scenarios.markedAsset("data.json", "public-worker", "t1")]);
    for (const res of [page, script]) expect(res.body).not.toMatch(TOKEN);
  });

  it("/marked/kinds/:name asks for data.json in each of the ways, as <name>-<kind>", async () => {
    const res = await fetchOk(app, scenarios.markedKinds("public", "t1"));
    const url = (kind: string): string => scenarios.markedAsset("data.json", `public-${kind}`, "t1");
    const attr = (kind: string): string => url(kind).replaceAll("&", "&amp;");
    expect(res.body).toContain(`<link rel="prefetch" href="${attr("prefetch")}">`);
    expect(res.body).toContain(`<link rel="preload" as="fetch" crossorigin href="${attr("preload")}">`);
    expect(res.body).toContain(`navigator.sendBeacon("${url("beacon")}")`);
    expect(res.body).toContain(`fetch("${url("keepalive")}", { keepalive: true })`);
    expect(res.body).toContain(`new EventSource("${url("eventsource")}")`);
    // The constant a consumer iterates names exactly the ways on the page.
    expect(res.body.match(/data\.json/g)).toHaveLength(MARKED_KINDS.length);
    for (const kind of MARKED_KINDS) expect(res.body).toContain(`from=public-${kind}`);
    expect(res.body).not.toMatch(TOKEN);
  });

  it("a beacon's POST to data.json is answered, not refused", async () => {
    const res = await app.inject({ method: "POST", url: scenarios.markedAsset("data.json", "public-beacon", "t1") });
    expect(res.statusCode).toBe(204);
  });

  it("/marked/websocket/:name opens the socket on load and carries no token", async () => {
    const res = await fetchOk(app, scenarios.markedWebSocket("public", "t1"));
    expect(res.body).toContain(`new WebSocket("ws://" + location.host + "${scenarios.markedSocket("public", "t1")}")`);
    expect(res.body).not.toMatch(TOKEN);
  });

  it("/marked/socket answers a plain GET with 426", async () => {
    const res = await app.inject(scenarios.markedSocket("public", "t1"));
    expect(res.statusCode).toBe(426);
    expect(res.headers.upgrade).toBe("websocket");
  });

  /** Opens a WebSocket to the listening fixture and reports how the handshake went. */
  const handshake = async (path: string): Promise<{ result: "open" | "error"; port: number }> => {
    // inject() cannot upgrade, so these listen for real.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}${path}`);
    const result = await new Promise<"open" | "error">((resolve) => {
      ws.addEventListener("open", () => {
        resolve("open");
      });
      ws.addEventListener("error", () => {
        resolve("error");
      });
    });
    ws.close();
    return { result, port };
  };

  it("/marked/socket records the handshake in the request log like any other request", async () => {
    // Nothing else can hold a WebSocket back, so the log is where a consumer
    // learns that one was opened.
    const { result, port } = await handshake(scenarios.markedSocket("public", "t1"));
    expect(result).toBe("open");
    const log = (await (await fetch(`http://127.0.0.1:${String(port)}/__requests`)).json()) as RequestLog;
    expect(log.requests.map((r) => `${r.method} ${r.url}`)).toContain(`GET ${scenarios.markedSocket("public", "t1")}`);
  });

  it("/marked/socket refuses a handshake it cannot build, and still logs it", async () => {
    const { result, port } = await handshake("/marked/socket?from=Public&tag=t1");
    expect(result).toBe("error");
    const log = (await (await fetch(`http://127.0.0.1:${String(port)}/__requests`)).json()) as RequestLog;
    expect(log.requests.map((r) => r.url)).toContain("/marked/socket?from=Public&tag=t1");
  });
});

describe("malformed scenario parameters", () => {
  let app: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    app = buildFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["not a number", "/slow-response?delayMs=abc"],
    ["negative", "/slow-response?delayMs=-1"],
    ["empty", "/slow-response?delayMs="],
    ["over the ceiling", "/slow-response?delayMs=999999999"],
    ["status not a number", "/http-status/abc"],
    ["status out of range", "/http-status/999"],
    ["bytes not a number", "/large-body?bytes=abc"],
    ["storage bytes not a number", "/large-storage?bytes=abc"],
    ["storage bytes over the quota-derived ceiling", "/large-storage?bytes=67108864"],
    ["slow-body overMs not a number", "/slow-body?bytes=10&overMs=abc"],
    ["hops not a number", "/server-redirect-chain/abc"],
    ["failTimes not a number", "/fails-then-succeeds?failTimes=abc"],
    ["afterMs not a number", "/links/js-late?afterMs=abc"],
    ["afterMs over the ceiling", "/links/js-late?afterMs=999999"],
    ["fetch-late takesMs not a number", "/fetch-late?takesMs=abc"],
    ["fetch-late takesMs over the ceiling", "/fetch-late?takesMs=999999999"],
    ["ticker periodMs below the floor", "/ticker?periodMs=0"],
    ["ticker forMs over the ceiling", "/ticker?forMs=999999"],
    ["fan-out n not a number", "/links/fan-out?n=abc"],
    ["fan-out n over the ceiling", "/links/fan-out?n=99999"],
    ["leaf id not a number", "/links/leaf/abc"],
    ["leaf id below the range", "/links/leaf/0"],
    ["cycle side that is neither", "/links/cycle/c"],
    ["marked name with an uppercase letter", "/marked/page/Secret?tag=t1"],
    ["marked page without a tag", "/marked/page/secret"],
    ["marked tag with markup in it", "/marked/page/secret?tag=%3Cb%3E"],
    ["marked embed that is not a name", "/marked/page/public?tag=t1&embed=a%2Fb"],
    ["marked embedOrigin with nothing to embed", "/marked/page/public?tag=t1&embedOrigin=http%3A%2F%2Fb.example"],
    ["marked embedOrigin with a path", "/marked/page/public?tag=t1&embed=secret&embedOrigin=http%3A%2F%2Fb.example%2Fx"],
    ["marked embedOrigin with a quote in it", "/marked/page/public?tag=t1&embed=secret&embedOrigin=http%3A%2F%2Fb%22x"],
    ["marked hops of zero", "/marked/server-redirect/0/secret?tag=t1"],
    ["marked hops over the ceiling", "/marked/server-redirect/21/secret?tag=t1"],
    ["marked asset without from", "/marked/asset/pixel.svg?tag=t1"],
    ["marked popup name with an uppercase letter", "/marked/popup/Secret?tag=t1"],
    ["marked worker without a tag", "/marked/worker/public"],
    ["marked kinds name that is not a name", "/marked/kinds/a%2Fb?tag=t1"],
    ["marked websocket without a tag", "/marked/websocket/public"],
    ["marked socket without from", "/marked/socket?tag=t1"],
    ["marked worker script without from", "/marked/asset/worker.js?tag=t1"],
  ])("rejects %s", async (_name, url) => {
    expect((await app.inject(url)).statusCode).toBe(400);
  });

  // Coercion still has to work, or every consumer breaks at once.
  it.each([
    ["/slow-response?delayMs=5", 200],
    ["/http-status/503", 503],
    ["/http-status/204", 204],
    ["/server-redirect-chain/2", 302],
    ["/large-body?bytes=100", 200],
    ["/large-storage?bytes=2048", 200],
    ["/slow-body?bytes=10&overMs=0", 200],
    ["/links/js-late?afterMs=0", 200],
    ["/fetch-late?afterMs=0&takesMs=0", 200],
    ["/ticker?periodMs=10&forMs=0", 200],
    ["/links/fan-out?n=0", 200],
    ["/links/leaf/200", 200],
    ["/marked/page/secret?tag=t1", 200],
    ["/marked/server-redirect/1/secret?tag=t1", 302],
    ["/marked/server-redirect/20/secret?tag=t1", 302],
  ])("still serves %s", async (url, expected) => {
    expect((await app.inject(url)).statusCode).toBe(expected);
  });
});
