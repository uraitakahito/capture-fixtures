---
title: Scenarios
description: Every route capture-fixtures serves, what it returns, and the failure mode each one exists to reproduce
---

Each route exists to make **one specific thing** happen on demand. This page is
the reason each one is there — the part a table of paths cannot carry.

## Use the typed helper, not the paths

Hard-coding `/fails-then-succeeds?failTimes=2&key=x` in a consumer means a rename in capture-fixtures breaks
that consumer silently, months later, in a repo nobody is looking at. The
`scenarios` export is the one place these URLs are written down:

```ts file="src/scenarios.ts#scenarios"
```

Prefix with the fixture origin:

```ts
import { scenarios } from "capture-fixtures";

const url = `http://${meadowIp}:8080` + scenarios.failsThenSucceeds(2, "retry-budget");
```

## Static pages

### `/plain-html` — the success baseline

Plain 200 HTML, no scripts, no sub-resources. Every other scenario is only
meaningful against a control that is known to work; when a test fails, `/plain-html`
answers "is the pipeline broken, or is this scenario doing its job?".

### `/client-side-redirect` → `/redirect-target` — client-side navigation

Serves a page whose only content is `location.replace("/redirect-target")`, running at
parse time.

This destroys the JavaScript execution context **while the capture code is
mid-`await`**. Puppeteer surfaces that as `Execution context was destroyed,
most likely because of a navigation`, and any code that touches the page across
that boundary throws. BrowserHive's `runOnStableContext` exists for this; this
route is what proves it works.

A server-side 302 does *not* reproduce it — the browser follows the redirect
before the page ever exists. It has to be the page navigating itself.

### `/lazy-images` — deferred sub-resources

3000px of filler, then two images below the fold, each deferred by a **different
mechanism**:

- `<img loading="lazy">` — the browser's own deferral
- `<img data-src>` swapped by an `IntersectionObserver`

Neither image is requested until something scrolls. A capture that grabs the
page without scrolling produces an archive missing both, and — this is the
awkward part — the archive still looks fine: correct HTML, no errors, just
images that 404 on replay.

Two mechanisms rather than one because they fail differently: native `lazy`
responds to the viewport, the observer responds to layout. A behaviour that
scrolls instantly to the bottom can satisfy one and miss the other.

### `/endless-feed` — a page with no bottom

A page that grows itself as it is scrolled. **Scrolling never reaches an end.**

An archiver capturing an infinite feed has to give up somewhere. The question
is not whether it gives up but whether the artifact says so, and this fixture
is the giving-up case — without it, the thing you check against is a real
website.

:::caution[Do not "fix" this to use `IntersectionObserver`]
Real feeds append with an observer. The `scroll` handler here is deliberate.

BrowserHive's `autoscroll` decides it has reached the end by scrolling, waiting
250ms, and checking whether `scrollY` moved. A `scroll` handler runs
synchronously with the scroll, so the page has always grown by then. An
observer callback is asynchronous, and one late callback produces a false
report of having reached the bottom.

The test then goes red — but what broke is the fixture, not the thing under
test. A test that is red now and then eventually gets a `retry` bolted on, and
after that it is testing nothing.

What is wanted here is not realism. It is the guarantee that the bottom is
never reached.
:::

Three screens of runway are kept below the scroll position at all times. One
races the check outright; two still races it on the fractional final step. That
the three matters is verified in browserhive's e2e — reduce it and that test
turns red.

### `/cookie-banner` — a fixed overlay

Content with a `position: fixed` bar pinned to the bottom, carrying a cookie
notice and an Accept button that removes it.

Whatever a consumer does about overlays — remove them, ignore them, click
through them — this is a page where one demonstrably exists, so the difference
between "handled" and "not handled" is visible in a screenshot.

### `/responsive-images` — variants a capture never asks for

Four elements, each offering an image the browser will not request at the
capture viewport: an `<img srcset>` with 1x/2x/3x, a `<picture>` whose
`<source>` is behind a media query, an `<img data-srcset>`, and a
`<video poster>`.

A capture at 1280px and DPR 1 picks exactly one candidate per element. The
others are never requested, so a Retina replay finds them missing — the failure
BrowserHive's `autofetch` behaviour exists to prevent. Before this page, that
behaviour had nothing to act on: its test ran against `/plain-html`, which has
no images, and could only assert that autofetch had run.

`hero.svg` is the control. The browser requests it unprompted, so a run where
only it arrives says "autofetch did not run", not "the page failed to load".

:::caution[The media query threshold is load-bearing]
`<source>` is behind `(min-width: 2000px)` and the capture viewport is 1280px,
so the browser can never choose `wide.svg`. Its arrival is therefore proof that
something fetched it deliberately.

Lowering that threshold to a width a capture does match would let the browser
pick it unprompted. A consumer's control test — "with autofetch off, the
variant is absent" — would stop discriminating, and would keep passing while it
did.
:::

### `/cookie-and-storage` — state that outlives a page

Sets `capture-fixtures=<tag>` as an HttpOnly cookie **and** writes the same tag to both
`localStorage` and `sessionStorage`. The page reports what *arrived* before
overwriting it, so a consumer reads the previous capture's state rather than
its own.

Three stores because they are cleared by different mechanisms and a reset that
handles some of them leaves the rest. `sessionStorage` is the discriminating
one: the tab carries it, not the browser context, so it is the only store that
separates "the same context was reused" from "the same tab was reused". That leak matters: a worker reuses its
browser across captures, so state from task N shows up in task N+1's archive —
and it shows up as *content*, silently, not as an error.

## Parameterised routes

### `/slow-response?delayMs=` — page-load timeouts

Waits `delayMs` before sending anything. **Defaults to 35000**, deliberately more
than BrowserHive's 30-second page-load timeout, so `scenarios.slowResponse()` with no
argument is already a timeout.

Note where the delay is: before the *response*, not during it. The socket is
open and nothing arrives — the case that hangs a naive fetch forever. For a
response that starts and then stalls, use `/slow-body`.

### `/block-main-thread?holdMs=&repeatForMs=` — a page that stops responding

Holds the page's main thread for `holdMs` at a time, repeating for
`repeatForMs`. While it is held, nothing else in the page runs: `setTimeout`
callbacks cannot fire and an injected `page.evaluate` cannot even start.

**This is not the same as a slow network.** `/slow-response` delays the *response*; the
page it eventually serves works normally. Here the response is instant and the
page is the thing that stops working. A consumer that only ever tested against
slow responses has never exercised the timeouts that guard its in-page
operations, because nothing it did could make them expire.

That is what this route is for. BrowserHive wraps each browser operation in a
budget that asks *"is this one operation stuck?"*, and those budgets are worth
very little until something has proved they still fire. In particular they must
keep firing when `operationDelayMs` is in play — a capture deliberately slowed
down is not a capture that may run forever.

**The holding starts from a `setTimeout`, never during parsing.** Blocking the
parse would delay `DOMContentLoaded` itself, and the cost would land on the
consumer's *navigation* budget (30s in BrowserHive) instead of the much tighter
budgets around in-page work (5s). Same page, entirely different test.

`repeatForMs` is capped at 30000. A page that holds its thread forever outlives
the capture that asked for it and wedges whatever runs next in the same tab.

### `/fetch-late?afterMs=&takesMs=` — the network is the only late thing

`afterMs` after load (default 0) the page fetches `/slow-response` for `takesMs`
(default 5000) and does nothing with the answer. No element is added, no text
changes: the DOM is as quiet as `/plain-html`, and the network is not.

This is for a consumer that ends its post-load wait on a *signal* rather than a
timer. A DOM-quiet signal fires before the fetch finishes; a network-quiet one
waits for it. Pass a `takesMs` past the consumer's deadline and the question
becomes how it records "the page was still loading" — as a failure, or as an
observation next to the capture.

Both delays are the caller's, so there is no race to lose: a red result here is
about the consumer's signal, not about timing.

### `/ticker?periodMs=&forMs=` — a page that never settles

Rewrites `#clock` every `periodMs` (default 250, floor 10) for `forMs` (default
30000, the ceiling). Nothing is fetched, so the network is quiet from the first
byte; the DOM never is.

The mirror image of `/fetch-late`. A consumer waiting for the DOM to go quiet
reaches its deadline on this page — every carousel, clock and rotating ad on the
real web is this page — and what matters is whether it says so rather than
reporting a settled capture.

`periodMs` has a floor because a period of 0 is a page that never yields, which
is `/block-main-thread`'s job and a different observation. The stop at `forMs`
is a `setTimeout` chain, not a `setInterval`, so the page keeps its own deadline
instead of leaving a timer running in whatever the tab does next.

### `/http-status/:code` — the non-2xx branch

Returns exactly the status asked for, with a body. Any code: `/http-status/404`,
`/http-status/503`, `/http-status/418`.

The body matters. A pipeline that only checks the status treats these
identically, but one that captures the response has to decide whether an error
page is an artifact worth keeping — and that decision needs a real body to act
on.

### `/server-redirect-chain/:hops` — redirect chains

A 302 chain of length `n`, ending at `/redirect-target`. `/redirect/3` is four hops:
`3 → 2 → 1 → 0 → /redirect-target`.

Chain length is the parameter because redirect handling usually breaks at a
limit rather than at one hop. Browsers cap chains around 20; a chain longer
than the cap is how you test what happens at the boundary rather than in the
middle.

### `/large-body?bytes=` — response-size caps

A body of exactly `bytes` bytes, sent at once. Defaults to 1 MiB.

An archiver has to cap what it stores or a single video swallows the disk. This
route makes the cap testable from both sides: one byte under, one byte over.

### `/slow-body?bytes=&overMs=` — slow bodies

`bytes` bytes trickled over roughly `overMs`, in ten chunks.

Different failure from `/slow-response`: here the response **starts immediately** and
then arrives slowly. Headers are in, the status is 200, and a timeout measured
from request-start behaves differently from one measured between chunks. Code
that treats "response received" as "done" passes `/slow-response` and hangs on `/slow-body`.

### `/large-storage?bytes=` — caps on recorded storage values

Fills both web storage areas until they total `bytes`, one key per area.
Defaults to 3 MiB.

An archiver that records the *values* in web storage, not just their size, has
the same problem `/large-body` poses for response bodies — except storage is
read out of the page rather than received from an origin, so a byte cap on
responses never counts it.

:::caution[`bytes` is a total, split between the two areas — on purpose]
Each area carries its own quota of roughly 5 MiB, and the browser counts that
quota in **UTF-16 code units** while an archiver measuring its own output counts
**UTF-8**. One ASCII character is 1 byte of UTF-8 and 2 of UTF-16, so a single
area tops out near 2.5 MB as the archiver measures it.

Put the whole total in one area and you hit the quota *before* the archiver's
ceiling — its cap never fires, and its test passes anyway, having proved
nothing. Splitting keeps each write inside its own quota while the total clears
a ceiling in the 2 MiB range.
:::

The page reports what it **actually** stored, per area, in `<pre id="stored">`,
along with any `QuotaExceededError`. A quota failure and a working cap look
identical in an archive — both leave values out — so read those numbers before
concluding the cap did anything.

### `/fails-then-succeeds?failTimes=&key=` — deterministic retries

Returns 503 for the first `failTimes` requests carrying `key`, then 200 for every
request after. Defaults to `fail=2`, `key=default`.

**`key` is what makes retry tests trustworthy.** The failure counter is
per-key, so two tests running at once do not consume each other's budget, and a
test that reruns in the same process starts from a clean count by using a fresh
key. Without it, "did the retry work?" would depend on execution order — the
classic flaky test, testing flakiness.

Pick a key per assertion, not per suite:

```ts
scenarios.failsThenSucceeds(2, "retry-budget-exhausted")
scenarios.failsThenSucceeds(1, "single-retry-then-success")
```

### `/assets/*` — static sub-resources

Serves `site/` (`hero.svg`, `below.svg`). Referenced by `/lazy-images`, and available
directly when a test needs a sub-resource whose bytes it can predict.

## Following links

Every page here is `/links/hub` with exactly one thing changed. That is what
makes the set discriminating: a crawler that follows nothing anywhere is broken,
one that follows everything is applying no rule at all, and only the difference
between the hub and a sibling separates the two.

### `/links/hub` — the crawl baseline

Three links to `/links/leaf/:id`, plus one to `/links/hidden`.

The hidden link is there on purpose. A crawler has to reach this page, parse it,
see that link, and still never fetch it — which is a different claim from "never
found it". A page nobody links to proves nothing about robots.

### `/links/leaf/:id` — where depth stops

A page with no outbound links. `id` changes the URL and nothing else: depth and
page budgets are counted in distinct URLs, so a fixture needing three more pages
needs three ids.

### `/links/nofollow` — `rel="nofollow"`

The hub's three links with `rel="nofollow"` on the third.

The first two are the control. Without them, a crawler that failed to parse the
page at all would look exactly like one honouring the attribute — both fetch
nothing, and both look correct.

### `/links/off-origin` — leaving the origin

Four links: one same-origin control, then a different host, a different port and
a different scheme.

The foreign host is under `.invalid`, which [RFC 2606](https://www.rfc-editor.org/rfc/rfc2606)
guarantees will never resolve. A crawler that wrongly follows it fails against a
name that cannot exist, rather than reaching a stranger's server from someone's
test suite.

All three kinds are here because an origin is scheme+host+port. An implementation
comparing only the host passes a host-only page while being wrong.

### `/links/fragments` — one resource, two spellings

`/links/leaf/1` and `/links/leaf/1#a`.

`#a` is a position inside a page, not another page. A crawler that keeps the
fragment captures the same page twice — and two archives of one page look exactly
like two archives of two pages.

### `/links/js` — links that only exist after script runs

Three anchors built at `DOMContentLoaded`.

:::caution[The served HTML contains no `<a` at all]
That is the scenario. A consumer extracting links from the response body finds
none; one extracting from the rendered DOM finds three. This is the only page
here that can tell those two implementations apart, and an anchor slipping into
the static HTML would silently end that.
:::

### `/links/js-late?afterMs=` — where a consumer stops looking

One anchor appended `afterMs` after load. Default 5000.

A `setTimeout`, deliberately, not an `IntersectionObserver`: the arrival is a
deadline the caller chose, not a callback that might be late. Pass a small
`afterMs` to assert the link **is** followed; raise it to find the boundary.

Before the timer fires the page carries no link, so "not yet" and "never" are the
same observation — which is exactly the position a consumer is in.

### `/links/cycle/:side` — `a` ⇄ `b`

Two pages linking to each other. `side` is `a` or `b`; anything else is a 404.

A crawler without deduplication walks this until some *other* limit stops it, and
then reports that limit as the reason it stopped. Nothing about the run looks
wrong — the depth or page budget did its job, on a crawl that should never have
got there.

### `/links/fan-out?n=` — page budgets

`n` links on one page, up to 200. Default 10.

The one generated page here. A budget is the only link behaviour that needs more
pages than a reader would want written out; everything else is a hand-written
control.

### `/links/hidden` — reachable, linked, and forbidden

A plain page, linked from the hub and disallowed by `/robots.txt`.

It is served, not 404'd. If it were missing, a crawler ignoring robots would also
fail to fetch it and the scenario would pass for the wrong reason.

### `/robots.txt` — the only robots policy here

```
User-agent: *
Crawl-delay: 3
Disallow: /links/hidden
```

Fixed rather than parameterised: a crawler fetches `/robots.txt` with no query
string, so a knob could never reach it.

:::caution[The delay is 3s so that it can be seen to win]
A consumer that reads robots must end up waiting 3s between requests even when
its own spacing is shorter. A value **below** the consumer's own default would be
indistinguishable from being ignored — its spacing would dominate and the test
would pass either way.
:::

## Introspection

Two test-only endpoints. They exist because *how many times* something was
requested is often the actual assertion — a retry test that only checks the
final status cannot tell one retry from five.

### `GET /__request-counts`

Request count per URL, as a plain object:

```json
{ "/plain-html": 1, "/fails-then-succeeds?failTimes=2&key=retry-budget": 3 }
```

Keyed by **full URL including the query string**, so `/fails-then-succeeds?failTimes=2&key=a` and
`/fails-then-succeeds?failTimes=2&key=b` count separately — the same isolation `key` gives you for
the failure counter.

### `POST /__reset`

Clears both the hit counters and the flaky state.

Call it **between tests, not once per suite**. Both counters live in the server
process, so a container shared across a run accumulates state; the previous
test's hits are indistinguishable from this one's without a reset.

```ts
beforeEach(async () => {
  await fetch(`http://${meadowIp}:8080/__reset`, { method: "POST" });
});
```

### `GET /health`

Returns `{ "ok": true }`. Not part of `scenarios` — it is for waiting on the
container during startup, not for a test to assert on.

```sh
until curl -sf "http://${CAPTURE_FIXTURES_IP}:8080/health" >/dev/null; do sleep 1; done
```

### `GET /__version`

Which build is answering.

```json
{ "version": "0.5.0", "revision": "abc1234", "buildTime": "2026-08-01T03:12:44.108Z" }
```

Separate from `/health` on purpose. That route answers *are you up*, asked in a
tight loop by readiness waits; this one answers *which capture-fixtures is this*, asked
when a test fails for no visible reason and you start wondering whether the
container in front of you was ever rebuilt.

`revision` is the one that earns its place. A tag only moves at release time,
so during development every build reports the same `version` — but `revision`
changes with every commit, and comparing it against the submodule your consumer
pins is what catches a container you forgot to rebuild:

```sh
running=$(curl -s "http://${CAPTURE_FIXTURES_IP}:8080/__version" | jq -r .revision)
pinned=$(git -C capture-fixtures rev-parse --short HEAD)
[ "$running" = "$pinned" ] || echo "capture-fixtures is stale: $running vs $pinned"
```

`version` reads `unknown` and `revision` reads `dev` when the image was built
without `GIT_TAG` / `GIT_REV`. That is not a failure — it says the build did not
record where it came from, which is exactly the state in which staleness goes
unnoticed.
