import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture } from "../src/fixture.js";
import { scenarios } from "../src/scenarios.js";

/**
 * The arguments BrowserHive's E2E suite actually passes.
 *
 * capture-fixtures is consumed as a pinned git submodule, so a release here reaches
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
 *   browserhive/test/e2e/settle.e2e.test.ts      fetchLate(0, 5000), fetchLate(0, 500), ticker(),
 *                                                ticker(250, 1500), blockMainThread(100, 1200)   ← see below
 *   browserhive/test/e2e/page-document.e2e.test.ts  markedPage, markedServerRedirect(2, …),
 *                                                markedScriptRedirect, markedText, markedAsset   ← see below
 *   browserhive/test/e2e/sites.e2e.test.ts       markedPage(…, "secret", { embedOrigin })   ← see below
 *   browserhive/test/e2e/deny.e2e.test.ts        markedPopup, markedKinds, markedWorker, markedWebSocket,
 *                                                markedSocket, markedAsset("worker.js", …)   ← see below
 *
 * The last row is the exception to "actually passes": `/large-storage` and the
 * consumer's storage cap were written together, so the caller lands after this
 * release. It is recorded now because the argument is what set
 * `MAX_STORAGE_BYTES` — leaving it out would let a later tightening pass here
 * and break the caller it was sized for.
 *
 * The settle rows are the same shape (2026-09-13): `/fetch-late` and `/ticker`
 * were written for BrowserHive's post-load wait, whose e2e lands with the
 * consumer's next release. Recorded now for the same reason. So are the next two:
 * `ticker(250, 1500)` is a DOM that keeps changing for 1.5 s and then stops,
 * `blockMainThread(100, 1200)` a run of long tasks; the wait must outlast both.
 * (`linkJsLate(1500)` was recorded here first and never passed: one change
 * after a second of silence looks quiet to a one-second window.)
 *
 * The marked rows are that shape again (2026-09-26): `/marked/*` was written
 * for BrowserHive's test that a page it was told not to keep leaves nothing
 * behind, which lands with its next release. BrowserHive adds a suffix to each
 * tag so reruns against one fixture stay apart; the values here are the
 * shortest it sends.
 *
 * So is the embedOrigin row (2026-09-26). BrowserHive's e2e runs a second
 * instance in each of its sets — `capture-fixtures-b`, `-2-b`, `-3-b` — and
 * embeds from it. The row spells the longest of the three, so an origin bound
 * that would refuse one of them goes red here.
 *
 * The deny rows are that shape again (2026-09-26): the popup, kinds, worker and
 * WebSocket pages were written for BrowserHive's test that a request its policy
 * denies never leaves the capturing machine, which lands with its next release.
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
    ["fetchLate 5s past the consumer's deadline", scenarios.fetchLate(0, 5000)],
    ["fetchLate 500ms inside it", scenarios.fetchLate(0, 500)],
    ["ticker with the defaults", scenarios.ticker()],
    ["ticker for 1.5s, then still", scenarios.ticker(250, 1500)],
    ["blockMainThread 100ms held, 1.2s repeated", scenarios.blockMainThread(100, 1200)],
    ["markedPage secret", scenarios.markedPage("secret", "e7")],
    ["markedPage public embedding secret", scenarios.markedPage("public", "e13", "secret")],
    ["markedPopup secret", scenarios.markedPopup("secret", "d6")],
    ["markedOpener by window.open", scenarios.markedOpener("w5-open", "w5", { way: "open" })],
    ["markedOpener by a modifier click", scenarios.markedOpener("w5-modifier", "w5", { way: "modifier" })],
    [
      "markedOpener asking from another site",
      scenarios.markedOpener("w9", "w9", { embedOrigin: "http://capture-fixtures-3-b.browserhive:8080" }),
    ],
    ["markedKinds secret", scenarios.markedKinds("secret", "d9")],
    ["markedWorker secret", scenarios.markedWorker("secret", "d10")],
    ["markedAsset worker.js", scenarios.markedAsset("worker.js", "secret", "d10")],
    ["markedWebSocket secret", scenarios.markedWebSocket("secret", "d12")],
    ["markedSocket secret", scenarios.markedSocket("secret", "d12")],
    [
      "markedPage public embedding secret from another site",
      scenarios.markedPage("public", "s2", "secret", { embedOrigin: "http://capture-fixtures-3-b.browserhive:8080" }),
    ],
    ["markedServerRedirect 2 hops", scenarios.markedServerRedirect(2, "secret", "e8")],
    ["markedScriptRedirect", scenarios.markedScriptRedirect("secret", "e11")],
    ["markedText", scenarios.markedText("secret", "e12")],
    ["markedAsset pixel.svg", scenarios.markedAsset("pixel.svg", "secret", "e7")],
    ["markedAsset data.json", scenarios.markedAsset("data.json", "secret", "e7")],
  ])("%s is not refused", async (name, path) => {
    // 404, 503 and 302 are all legitimate answers; 400 means a bound is too
    // tight and the submodule bump would break the downstream suite.
    expect((await app.inject(path)).statusCode, `${name} → ${path}`).not.toBe(400);
  });
});

/**
 * The second consumer, added 2026-09-09.
 *
 * capture-ledger vendors capture-fixtures directly (`.upstream/capture-fixtures`) rather than through
 * BrowserHive, so its pin moves independently — and a bound tightened here
 * reaches it on its own schedule. Same reason as the block above: a value that
 * has become a 400 should say so in a unit test, not in a suite that needs
 * containers, a browser and a Postgres.
 *
 * The crawl e2e seeds `/links/hub` and lets the crawler find the rest, so the
 * values below are the ones it passes directly, not every page it visits.
 */
describe("values capture-ledger's crawl e2e passes today", () => {
  let app: ReturnType<typeof buildFixture>;

  beforeEach(() => {
    app = buildFixture();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["linkFanOut(50) — over capture-ledger's default maxPages of 30", scenarios.linkFanOut(50)],
    ["linkJsLate(250) — inside any settle window", scenarios.linkJsLate(250)],
    ["linkJsLate(60000) — past every settle window", scenarios.linkJsLate(60_000)],
    ["linkLeaf(1)", scenarios.linkLeaf(1)],
    ["linkCycle a", scenarios.linkCycle("a")],
  ])("%s is not refused", async (name, path) => {
    expect((await app.inject(path)).statusCode, `${name} → ${path}`).not.toBe(400);
  });
});
