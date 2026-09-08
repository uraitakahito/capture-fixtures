import { runInNewContext } from "node:vm";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture, REQUEST_LOG_LIMIT, type RequestLog } from "../src/fixture.js";
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

  it("/__requests keeps the headers that explain caching, and no others", async () => {
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
  ])("still serves %s", async (url, expected) => {
    expect((await app.inject(url)).statusCode).toBe(expected);
  });
});
