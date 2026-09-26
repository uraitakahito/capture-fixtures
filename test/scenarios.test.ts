import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture } from "../src/fixture.js";
import { scenarios } from "../src/scenarios.js";

describe("scenarios URL contract", () => {
  it("builds parameterised paths", () => {
    expect(scenarios.plainHtml).toBe("/plain-html");
    expect(scenarios.endlessFeed).toBe("/endless-feed");
    expect(scenarios.slowResponse(30000)).toBe("/slow-response?delayMs=30000");
    expect(scenarios.httpStatus(404)).toBe("/http-status/404");
    expect(scenarios.serverRedirectChain(3)).toBe("/server-redirect-chain/3");
    expect(scenarios.largeBody(2048)).toBe("/large-body?bytes=2048");
    expect(scenarios.slowBody(100, 500)).toBe("/slow-body?bytes=100&overMs=500");
    expect(scenarios.fetchLate(0, 5000)).toBe("/fetch-late?afterMs=0&takesMs=5000");
    expect(scenarios.ticker()).toBe("/ticker?periodMs=250&forMs=30000");
    expect(scenarios.ticker(50, 100)).toBe("/ticker?periodMs=50&forMs=100");
    expect(scenarios.asset("hero.svg")).toBe("/assets/hero.svg");
    expect(scenarios.markedPage("secret", "e7")).toBe("/marked/page/secret?tag=e7");
    expect(scenarios.markedPage("public", "e13", "secret")).toBe("/marked/page/public?tag=e13&embed=secret");
    expect(scenarios.markedText("secret", "e12")).toBe("/marked/text/secret?tag=e12");
    expect(scenarios.markedServerRedirect(2, "secret", "e8")).toBe("/marked/server-redirect/2/secret?tag=e8");
    expect(scenarios.markedScriptRedirect("secret", "e11")).toBe("/marked/script-redirect/secret?tag=e11");
    expect(scenarios.markedAsset("data.json", "secret", "e7")).toBe("/marked/asset/data.json?from=secret&tag=e7");
  });

  it("url-encodes counter keys so parallel tests stay isolated", () => {
    expect(scenarios.failsThenSucceeds(2, "a b")).toBe("/fails-then-succeeds?failTimes=2&key=a%20b");
  });

});

/**
 * Every path the contract names must be served by the running fixture.
 *
 * `scenarios` is a cross-repo contract — BrowserHive imports it as a workspace
 * dependency — and its type is `string`, so renaming a route in `fixture.ts`
 * without updating `scenarios.ts` compiles cleanly. It breaks in another repo's
 * E2E suite, as a 404, much later.
 *
 * Only the status is asserted here. What each page contains is `fixture.test.ts`
 * work; this suite answers one question: does a route exist for every entry?
 */
describe("every scenario reaches the fixture", () => {
  let app: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    app = buildFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  const STATIC: [string, string][] = Object.entries(scenarios).flatMap(([name, value]) =>
    typeof value === "string" ? [[name, value] as [string, string]] : [],
  );

  // Parameterised entries need an argument, so they are listed with a
  // representative value. The numbers carry no meaning beyond being valid.
  const BUILT: [string, string][] = [
    ["cookieAndStorage", scenarios.cookieAndStorage("probe")],
    ["slowResponse", scenarios.slowResponse(50)],
    ["slowBody", scenarios.slowBody(64, 20)],
    ["largeBody", scenarios.largeBody(256)],
    ["largeStorage", scenarios.largeStorage(2048)],
    ["httpStatus", scenarios.httpStatus(503)],
    ["serverRedirectChain", scenarios.serverRedirectChain(2)],
    ["failsThenSucceeds", scenarios.failsThenSucceeds(1, "contract")],
    ["blockMainThread", scenarios.blockMainThread(10, 20)],
    ["fetchLate", scenarios.fetchLate(0, 50)],
    ["ticker", scenarios.ticker(50, 100)],
    ["linkLeaf", scenarios.linkLeaf(1)],
    ["linkJsLate", scenarios.linkJsLate(50)],
    ["linkCycle", scenarios.linkCycle("a")],
    ["linkFanOut", scenarios.linkFanOut(3)],
    ["markedPage", scenarios.markedPage("secret", "contract")],
    ["markedText", scenarios.markedText("secret", "contract")],
    ["markedServerRedirect", scenarios.markedServerRedirect(1, "secret", "contract")],
    ["markedScriptRedirect", scenarios.markedScriptRedirect("secret", "contract")],
    ["markedAsset", scenarios.markedAsset("pixel.svg", "secret", "contract")],
    ["asset", scenarios.asset("hero.svg")],
  ];

  // A suite that claims "every scenario" has to prove the claim. Without this,
  // adding an entry to scenarios.ts and forgetting BUILT would quietly turn a
  // full check back into a partial one — permanently green, reading as coverage.
  it("covers every entry in the contract", () => {
    expect(STATIC.length + BUILT.length).toBe(Object.keys(scenarios).length);
  });

  // 302 and 503 are correct answers here, so the assertion is about existence.
  it.each([...STATIC, ...BUILT])("%s is served", async (name, path) => {
    const res = await app.inject(path);
    expect(res.statusCode, `${name} → ${path}`).not.toBe(404);
  });
});
