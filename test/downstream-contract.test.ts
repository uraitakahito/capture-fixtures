import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture } from "../src/fixture.js";
import { scenarios } from "../src/scenarios.js";

/**
 * The arguments BrowserHive's E2E suite actually passes.
 *
 * meadow is consumed as a pinned git submodule, so a release here reaches
 * nobody until someone bumps that pin. This suite is what makes the bump safe:
 * if a bound added to `fixture.ts` is too tight for a real caller, it goes red
 * here — in a plain unit test — instead of in a suite that needs containers and
 * a browser.
 *
 * Recorded 2026-09-08 from:
 *   browserhive/test/e2e/truncation.e2e.test.ts  largeBody(capBytes + 1 MiB), capBytes ≤ 1 MiB
 *   browserhive/test/e2e/behaviors.e2e.test.ts   blockMainThread(6000, 20_000)
 *   browserhive/test/e2e/session.e2e.test.ts     cookieAndStorage(mark)
 *   browserhive/test/e2e/retry.e2e.test.ts       failsThenSucceeds(2, "e2e")
 *   browserhive/test/e2e/session.e2e.test.ts     largeStorage(3 MiB)   ← see below
 *
 * The last row is the exception to "actually passes": `/large-storage` and the
 * consumer's storage cap were written together, so the caller lands after this
 * release. It is recorded now because the argument is what set
 * `MAX_STORAGE_BYTES` — leaving it out would let a later tightening pass here
 * and break the caller it was sized for.
 *
 * This is a copy, so it goes stale. Re-read the downstream call sites when
 * bumping the submodule; a green run here is evidence about the values below,
 * not about whatever BrowserHive passes today.
 */
describe("values BrowserHive passes today", () => {
  let app: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    app = buildFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["largeBody at 2 MiB", scenarios.largeBody(2 * 1024 * 1024)],
    ["blockMainThread 6s held, 20s repeated", scenarios.blockMainThread(6000, 20_000)],
    ["failsThenSucceeds(2)", scenarios.failsThenSucceeds(2, "e2e")],
    ["httpStatus(404)", scenarios.httpStatus(404)],
    ["asset below.svg", scenarios.asset("below.svg")],
    ["cookieAndStorage with a tag", scenarios.cookieAndStorage("mark")],
    ["largeStorage at 3 MiB", scenarios.largeStorage(3 * 1024 * 1024)],
  ])("%s is not refused", async (name, path) => {
    // 404, 503 and 302 are all legitimate answers; 400 means a bound is too
    // tight and the submodule bump would break the downstream suite.
    expect((await app.inject(path)).statusCode, `${name} → ${path}`).not.toBe(400);
  });
});

/**
 * The second consumer, added 2026-09-09.
 *
 * waggle vendors meadow directly (`.upstream/meadow`) rather than through
 * BrowserHive, so its pin moves independently — and a bound tightened here
 * reaches it on its own schedule. Same reason as the block above: a value that
 * has become a 400 should say so in a unit test, not in a suite that needs
 * containers, a browser and a Postgres.
 *
 * The crawl e2e seeds `/links/hub` and lets the crawler find the rest, so the
 * values below are the ones it passes directly, not every page it visits.
 */
describe("values waggle's crawl e2e passes today", () => {
  let app: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    app = buildFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["linkFanOut(50) — over waggle's default maxPages of 30", scenarios.linkFanOut(50)],
    ["linkJsLate(250) — inside any settle window", scenarios.linkJsLate(250)],
    ["linkJsLate(60000) — past every settle window", scenarios.linkJsLate(60_000)],
    ["linkLeaf(1)", scenarios.linkLeaf(1)],
    ["linkCycle a", scenarios.linkCycle("a")],
  ])("%s is not refused", async (name, path) => {
    expect((await app.inject(path)).statusCode, `${name} → ${path}`).not.toBe(400);
  });
});
