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

### `/csp/strict` — a page whose policy forbids eval

The same page as `/plain-html`, sent with
`content-security-policy: script-src 'self'; report-uri /csp/report`. It exists for a script a
consumer runs in the page: a library that compiles code with `new Function` behaves differently
here, and the site it runs on hears about it.

The policy sets `script-src` and no `default-src`. A `default-src` would also forbid inline styles,
and BrowserHive's `hideScrollbars` (`page.addStyleTag`) would then fail the capture before the
script runs.

### `POST /csp/report` — what the browser told the site

Where the page sends a report of each violation. It answers 204 and drops the body: the number of
reports in `/__request-counts` is the assertion. A report reaches this route only because a script
broke the policy, so 0 means none did, as long as a control on the same page has shown that a
violation does arrive here.

It is POST only, so it is not in `scenarios`, every entry of which a consumer can GET. The path and
the type are exported as `CSP_REPORT`.

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

The `autoscroll` script ([capture-scripts](https://github.com/uraitakahito/capture-scripts)) decides it has reached the end by scrolling, waiting
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

Content under a `position: fixed` overlay that covers the whole viewport
(`inset: 0`, `z-index: 9999`), carrying a cookie notice and an Accept button
that removes it.

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
the `autofetch` script ([capture-scripts](https://github.com/uraitakahito/capture-scripts)) exists to prevent. Before this page, that
script had nothing to act on: its test ran against `/plain-html`, which has
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

Sets `fixture-state=<tag>` as an HttpOnly cookie **and** writes the same tag to both
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
than BrowserHive's 30-second page-load timeout, so `/slow-response` with no
`delayMs` is already a timeout. (`scenarios.slowResponse(delayMs)` always
writes one.)

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

### `/fetch-storm?bytes=&everyMs=&burst=&forMs=` — bodies still being read when recording stops

Every `everyMs` (default 40, floor 10) the page starts `burst` fetches (default
3, at most 10) of `/compressible-body` at `bytes` bytes (default 5 MB), until
`forMs` has passed (default 30000, the ceiling).

This is for a consumer that reads a response body back from the browser after
the response has loaded, the way CDP's `Network.getResponseBody` works. Reading
megabytes back takes tens of milliseconds, so on this page several reads are in
flight at any instant, including the instant the consumer stops recording. A
consumer that does not wait for them, and does not say which ones it gave up on,
leaves an archive that disagrees with itself: a response without its request, a
200 with an empty body, a count with no record behind it.

Every request carries its own `i` (1, 2, 3, …), so one request is one URL and
an archive can be checked request by request. `/__request-counts` says how many
the page really sent. That is the control: an archive with nothing wrong in it
proves little if the page had stopped asking.

The bodies are gzipped rather than merely large, and `/compressible-body`
below says why. Like `/ticker`, the page stops by itself at `forMs` with a
`setTimeout` chain.

### `/http-status/:code` — the non-2xx branch

Returns exactly the status asked for, with a body. Any code: `/http-status/404`,
`/http-status/503`, `/http-status/418`.

The body matters. A pipeline that only checks the status treats these
identically, but one that captures the response has to decide whether an error
page is an artifact worth keeping — and that decision needs a real body to act
on.

### `/server-redirect-chain/:hops` — redirect chains

A 302 chain of `hops` + 1 redirects, ending at `/redirect-target`.
`/server-redirect-chain/3` is four hops: `3 → 2 → 1 → 0 → /redirect-target`.

Chain length is the parameter because redirect handling usually breaks at a
limit rather than at one hop. Browsers cap chains around 20; a chain longer
than the cap is how you test what happens at the boundary rather than in the
middle.

### `/large-body?bytes=` — response-size caps

A body of exactly `bytes` bytes, sent at once. Defaults to 1 MiB.

An archiver has to cap what it stores or a single video swallows the disk. This
route makes the cap testable from both sides: one byte under, one byte over.

### `/compressible-body?bytes=` — small on the wire, large once decoded

`bytes` bytes of `a` (default 1 MiB), sent as gzip. Five megabytes travel as
about five kilobytes.

`/large-body` is the same size on both sides. A consumer that checks the wire
size first drops it without ever reading the body back, and one that records it
reaches its cumulative cap after a few dozen. Neither keeps a body read in
flight for long.

This route separates the two sizes. The wire size passes a consumer's first
check, so the consumer has to fetch the body, and only then learns the body is
over its cap. With a cap below `bytes`, every request costs a full read and
stores nothing, so a page can keep a consumer reading for as long as it likes.
`/fetch-storm` is that page.

An optional `i` is accepted and ignored. It is there so `/fetch-storm` can give
every request its own URL.

### `/warc/noise?bytes=&seed=` — bytes that do not compress

`bytes` bytes of pseudo-random data from `seed` (xorshift32), as
`application/octet-stream` with `no-store`. The same seed always gives the same
bytes. Defaults to 250,000 bytes from seed 1.

`/large-body` is `a` repeated. A consumer that gzips each record as it writes
it — every WARC writer does — turns a megabyte of that into a few hundred bytes,
so its file never grows and a rollover tied to file size never fires. These
bytes gzip to their own size, so the file grows by `bytes` per request and a
test can say where the rollover lands.

### `/warc/rollover?resources=&bytes=` — WARC rollover

A page with `resources` images, each `/warc/noise` of `bytes` with its own seed
(1 … `resources`). Defaults to 8 × 250,000 bytes.

A consumer that splits its WARC at a size limit needs a page that crosses the
limit a known number of times. With the defaults and a 1 MiB limit the file
crosses once: four images come to about a megabyte, the fifth takes the file
past the limit, and the remaining three (750 KB) stay in the second file. The
images are all the same size, so the order they arrive in does not change the
count. The bytes are not an image; the browser requests them all the same, and
the failed decode comes after the response has been recorded.

### `/slow-body?bytes=&overMs=` — slow bodies

`bytes` bytes trickled over roughly `overMs`, in ten chunks.

Different failure from `/slow-response`: here the response **starts** and then
arrives slowly. The status (200) and the headers go out with the first chunk,
`overMs` / 10 after the request, and the rest follows a chunk at a time, so a
timeout measured from request-start behaves differently from one measured
between chunks. Code
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
request after. Defaults to `failTimes=2`, `key=default`.

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

Serves the files in `site/`. Referenced by `/lazy-images` and
`/responsive-images`, and available directly when a test needs a sub-resource
whose bytes it can predict.

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

Two pages linking to each other. `side` is `a` or `b`; anything else is a 400.

A crawler without deduplication walks this until some *other* limit stops it, and
then reports that limit as the reason it stopped. Nothing about the run looks
wrong — the depth or page budget did its job, on a crawl that should never have
got there.

### `/links/fan-out?n=` — page budgets

`n` links on one page, up to 200. Default 10.

The one generated page here. A budget is the only link behaviour that needs more
pages than a reader would want written out; everything else is a hand-written
control.

### `/links/rules` — one link for each way a rule decides

Four links: `/links/leaf/1`, `/links/trap/1`, `http://skipped.invalid/page` and
`http://outside.invalid/page`.

Written for a crawler that takes a list of rules and decides each link by the
first rule it matches. Started with

```json
[{ "skip": "skipped.invalid" }, { "skip": "<origin>/links/trap/" },
 { "follow": "same-host" }, { "capture": "any" }]
```

it requests the leaf, never the trap, tries `outside.invalid` once and never
tries `skipped.invalid`.

The trap is skipped by URL prefix and `skipped.invalid` by domain, so the page
tells the two kinds of skip apart as well as skip from follow and capture. Both
foreign hosts are `.invalid`, so neither request can ever reach this fixture:
"tried" shows up only as a failure in the crawler's own report, and the request
log here answers for the leaf and the trap alone.

### `/links/trap/:n` — a calendar with no end in sight

Day `n` links to day `n + 1`, up to day 20, which links to nothing. Any other
`n` is a 400.

Every day is a new URL on the same host, so a same-host rule alone walks it until
the depth cap stops it — and then reports the cap as the reason. The calendar
ends at day 20 so a crawler with no cap at all still finishes.

### `/links/frameset` and the other frame pages — links one document down

The hub's four links live in `/links/frame/menu` (each with `target="right"`),
and the pages below load that document into a frame. None of their top documents
holds an `<a`, so a consumer that reads only the top document finds no link and,
asked to follow, stops after one page without complaint.

| Page | Top document | Where the four links are |
|---|---|---|
| `/links/frameset` | `<frameset>` of `/links/frame/menu` and `/links/frame/empty` | the menu frame |
| `/links/frameset-nested` | `<frameset>` whose only frame is `/links/frameset` | two documents down |
| `/links/iframe` | `<iframe src="/links/frame/menu">` | a same-origin iframe |
| `/links/iframe-other?embedOrigin=` | the same iframe, served by `embedOrigin` | a frame on another origin |
| `/links/iframe-blank` | a script-made `<iframe>` with no `src` | its `about:blank` document (absolute hrefs) |

`embedOrigin` is required on `/links/iframe-other` (400 without it), so the page
cannot quietly turn into `/links/iframe`. Point it at another instance of this
fixture. A page script cannot read a document from another origin, so a
consumer that reads frames through the page finds nothing there — that is the
control for the other four.

:::caution[The top documents contain no `<a` at all]
As on `/links/js`, an anchor slipping into a top document would let a consumer
that never looks inside frames pass. The tests hold every top document to zero.
:::

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

## Pages a consumer must not keep

For consumers that can be told not to keep a page — BrowserHive's `no-archive`
URL policy is what these were written for. The question is never "was the page
fetched": it has to be, or there is nothing to decline. It is "did anything
derived from it survive" — a screenshot, its HTML, its links, its recorded text.

Every page here writes three tokens — `title-<name>-<tag>`, `text-<name>-<tag>`
and `link-<name>-<tag>` — into its title, its visible text and a link's text,
and into no URL. A URL reaches an archive's index whether or not the page was
kept, so a token in one would be found in every archive and prove nothing. Take
the spelling from `markedTokens(name, tag)` rather than writing it out.

`name` changes the URL and nothing else: aim a policy at one name and the other
is the control. `tag` is yours — use a fresh one per test, and the request log
tells your test's requests apart from everyone else's.

### `/marked/page/:name?tag=` — the page

The three tokens, a link to `/marked/leaf`, an image and a script that fetches a
JSON document. The image and the fetch go to `/marked/asset/*` with
`?from=<name>&tag=<tag>`, and they are the point: they reach the request log
whether or not the consumer keeps the page, so they tell "rendered, then not
kept" apart from "never loaded".

`&embed=<other>` adds an iframe holding marked page `<other>` — for asking what a
consumer keeps of a page it was told not to keep but never navigated to.

`&embedOrigin=<origin>` serves that iframe from another instance of
capture-fixtures. Run a second one under another name and a browser treats it as
another site, with a process of its own — what a consumer watching only the page
never sees. Only a bare origin is accepted (`http://name:port`, no path), and only
together with `embed`; anything else is a 400. The embedded page's image and fetch
go to the instance that served it, and each entry in the request log carries
`host`, the name the request came in under.

### `/marked/text/:name?tag=` — the tokens as `text/plain`

The same three tokens, one per line. For a policy that decides by the
document's media type rather than by its URL.

### `/marked/server-redirect/:hops/:name?tag=` — `hops` redirects, then the page

Exactly `hops` 302s (1 to 20), then `/marked/page/:name` — unlike
`/server-redirect-chain/:hops`, which sends one more. None of the hops matches a
pattern aimed at `/marked/page/`; only the page they land on does. A consumer
that judges a page by the URL it asked for, or by the first response it
recorded, gets this one wrong.

### `/marked/script-redirect/:name?tag=` — a script sends the browser to the page

`location.replace` on load. It carries no token itself, so anything a test finds
came from the page the browser landed on.

### `/marked/popup/:name?tag=` — the page in a new window

`window.open` on load, opening `/marked/page/:name`. It carries no token itself.
A browser runs the window as a target of its own, apart from the page that
opened it, so a consumer that guards only the page it was asked to capture
misses whatever the window does.

### `/marked/opener/:name?tag=` — a page that keeps asking for a window

Keeps asking for a new window holding `/marked/page/:name`: once every `every`
ms (default 250), `times` times (default 20), by `way`. The ways are the four of
`MARKED_WINDOW_WAYS`: `open` (`window.open`), `link` (a click on a link with
`target="_blank"`), `form` (a `submit()` of a form with `target="_blank"`) and
`modifier` (a script-made click carrying the ctrl and meta keys, which a browser
turns into a new tab). It carries no token itself.

A browser refuses a window asked for without a user gesture, so on its own this
page opens nothing. A consumer that evaluates script in the page with a gesture
hands it one, and the next ask succeeds. The page keeps asking so that one ask
lands after whatever the consumer did. Every way leads to the same URL, so the
request log says the same thing whichever way opened it: `/marked/page/<name>`
is requested only by a window that was allowed to load it.

`embedOrigin` moves the asking into an iframe served by that origin, another
instance of this fixture run under another name. The page then only holds the
iframe, and the asking happens inside a frame the browser runs apart from the
page.

### `/marked/worker/:name?tag=` — a worker's own request

Starts a dedicated worker on load. The worker's script is
`/marked/asset/worker.js?from=<name>&tag=<tag>`, and it fetches `data.json` as
`from=<name>-worker` — a request from the worker, not from the page.

### `/marked/kinds/:name?tag=` — requests outside an ordinary fetch

Asks for `data.json` five ways on load, each as `from=<name>-<kind>`: a beacon
(`navigator.sendBeacon`, a POST), a `keepalive` fetch, `<link rel="prefetch">`,
`<link rel="preload">` and an `EventSource`. `MARKED_KINDS` names the five, so a
test iterates the constant rather than spelling the list.

### `/marked/websocket/:name?tag=`, `/marked/socket?from=&tag=` — a WebSocket

The page opens a WebSocket to `/marked/socket?from=<name>&tag=<tag>` on load. The
handshake reaches the request log like any other request, and that is how a test
learns one was opened: a browser offers no way to hold a WebSocket back. A plain
GET to the endpoint answers 426.

There is no service worker page. Registering one needs a secure context, and
this fixture serves plain http.

### `/marked/search/:name?tag=` — a search that changes the page, not the document

For consumers that act on a page before keeping it — type, press, wait — and
keep it at more than one moment. Its tokens are its own: the page shows
`before-<name>-<tag>` as served and `after-<name>-<tag>` once a search is drawn,
never both. Take the spelling from `markedSearchTokens(name, tag)`.

As served, it holds the before token, a form and an empty `#results`. The form
has a query field `#q`, a second text field `#token` and a button `#go` that
submits nothing. Pressing `#go` fetches
`/marked/search/:name/answer?tag=<tag>&q=<query>`, which answers
`{ q, mark, items }`: the after token as `mark`, and three results that repeat
the query. The page draws the results, puts the after token where the before
token was, keeps the query in localStorage as `marked-search:<name>`, and last
of all moves its URL to `/marked/search/:name/result?tag=<tag>` with
`history.pushState`. The document is never replaced, so a consumer that waits
for the URL to change finds the page already drawn.

Nothing reads `#token`. Its value goes into no request, no URL and no storage,
so if it turns up in anything a consumer kept, the consumer put it there. A
value typed into `#q` is the control: it goes into the answer's URL, so it is in
every archive that recorded the answer.

Both tokens reach an archive by ways other than a copy of the page: the before
token in the page's response, the after token in the answer's. A test asking
which moment a copy is from looks in that copy, not in the whole archive.

Opened directly, `/marked/search/:name/result?tag=` serves the page as first
served, as a single-page application's server does for any of its URLs. It shows
the before token, not a search's answer.

### `/marked/console/:mode/:name?tag=` — what a page writes to its own console

For consumers that keep what a page writes to its console. Its tokens are its
own, `<way>-<name>-<tag>`: one for each way the page reaches the console, so a
line a consumer kept says which way it came. Take the spelling from
`markedConsoleTokens(name, tag)`. The ways are `MARKED_CONSOLE_WAYS`:

```ts file="src/marked.ts#console-ways"
```

With `mode` `writes`, the page goes every one of those ways. Its iframe is
`/marked/console/writes/:name/frame?tag=` and its dedicated worker's script
`/marked/console/writes/:name/worker.js?tag=`.

`&embedOrigin=<origin>` serves the iframe from another instance of
capture-fixtures, as on `/marked/page`: another site, which a browser runs in a
process of its own. Only a bare origin is accepted.

The page joins each token as it runs, from the way, `name` and `tag` written
apart, so none of its URLs and none of its response bodies spells one. The
page's HTML, its iframe's HTML and its worker's script reach an archive whether
or not the console was kept; a token found anywhere a consumer stored came
through the console.

With `mode` `silent`, it is the same page with every write taken out: the same
iframe from the same origin and the same worker, writing nothing, throwing
nothing and rejecting nothing. A line a consumer files under this page came from
somewhere other than the page.

Both pages give `data:,` as their icon. Without one, a browser asks for
`/favicon.ico`, this fixture answers 404, and Chrome writes that 404 into the
page's console as an error — a line the silent page must not have. The other
pages here have no icon, so a consumer that keeps the console can find that 404
among their lines.

### `/marked/asset/*`, `/marked/leaf` — what the page loads and links to

`pixel.svg`, `data.json` (a beacon's POST to it is answered with 204), the
worker's `worker.js`, and the link target. None of them carries a token.

## Text a consumer has to keep as bytes

For consumers that archive what a server sent, byte for byte. A browser turns
text into characters before anything else sees it, so a consumer that reads a
body back as characters and writes it out as UTF-8 has changed it: invisibly
for UTF-8, plainly for anything else. These bodies are written so that the
change shows — Shift_JIS declared in the header, and UTF-8 with no charset at
all, which a browser handing a fetched body back as text reads as
windows-1252.

Every body is served from one table, exported as `CHARSET_FIXTURES`, so a test
compares an archive against the bytes that were sent rather than against a
copy of them:

```ts file="src/charset.ts#charset-fixtures"
```

### `/charset/` — one page that reads all of them

Two stylesheets (one of them `@import`s `nocharset.css`), the Shift_JIS
document in an iframe, `fetch()` of `sjis.css`, `nocharset.css`, `sjis.txt`,
`nocharset.txt` and `gzip.css`, and a POST to `/charset/echo`. The title
becomes `charset read` once every read has settled.

`nocharset.css` is a shape a real page produced: one stylesheet, read once
through `@import`, where `@charset` says UTF-8, and once through `fetch()`,
where only the header speaks and it says nothing. An archive that changed the
text keeps two different copies of one file. Everything is sent `no-store`, so
the stylesheet and the fetch are two requests every time.

The page itself and `import.css` come back unchanged whatever a consumer does
— UTF-8 said in a meta tag, and nothing but ASCII — so they are the comparison
that has to pass either way.

### `/charset/echo` — what a POST carried

The page POSTs `CHARSET_ECHO.body`, Shift_JIS labelled as Shift_JIS. The route
reads the body as bytes and answers 204, and the request's entry in
`/__requests` carries `bodySha256` and `bodyBytes`: what arrived, to compare
with what a consumer recorded as the request's body.

The page reads the empty answer too. Chrome aborts a fetch whose 204 nobody
reads (`net::ERR_ABORTED`), and a consumer then sees the POST fail rather than
finish, with no request body to record.

## Values a consumer must keep out of what it stores

For consumers that are handed a secret and told not to store it — the `secrets` of
a BrowserHive capture are what these were written for. A page that uses a secret
has to send it, and the site it goes to can send it back, so the value travels
further than the field it was typed into. Each route here adds one of those places,
with a value you chose (`src/login-echo.ts`).

Choose a value that encoding respells. `MARK p@ss+9z&é"<` reads differently in a
URL, in a form's body, in JSON and in HTML, so a consumer that searches for one
spelling leaves the others behind.

Whether the value went out is read from the other end: `/__requests` keeps the
headers and the form's body as they arrived. Without that, an archive with no value
in it is also what a page that never sent one leaves behind.

A route that repeats a value refuses an empty one with a 400. A page with no value
in it would pass a test that searches an archive for the value.

### `/login/form`, `POST /login/submit`, `/login/after` — a login

`/login/form` is an ordinary form with `#user` (already filled in, with
`LOGIN_DEFAULT_USER`), `#password`, `#note` and a submit button `#go`. A browser
that submits it sends the POST as a navigation of the page. `user` is not a secret,
so it is the control in that body: a consumer that replaced the others still has
this one.

`POST /login/submit` reads the body as `application/x-www-form-urlencoded`. The
entry in `/__requests` carries it as `bodyText`, next to `bodySha256` and
`bodyBytes`. It answers 302 to `/login/after` with
`Set-Cookie: session=<token>; Path=/`, where the token is `loginSessionToken(note)`.
It is POST only, so it is not in `scenarios`; the path and the type are exported as
`LOGIN_SUBMIT`.

The token is a digest of the note and contains no part of it. A consumer that hides
the note replaces it wherever it is spelled, so a token holding the note would
vanish with it, and a test could not tell whether the consumer also took the
cookie's own value for a secret. Take the spelling from `loginSessionToken` rather
than writing it out.

`/login/after` says `welcome <note>`, HTML-escaped, and has one link,
`/echo/text?v=plain`, which holds no value. Only a browser that brought the cookie
back gets this page; anything else is a 403. So the note in the document, like the
`cookie` in the request's log entry, says the cookie came back. The notes live in
the server process, one per session, until `POST /__reset`.

### `/echo/text?v=`, `/echo/json?v=` — the value in a text body

`/echo/text` repeats `v` once in a document, HTML-escaped. `/echo/json` answers
`{ "v": v }`. A site sending a value back as text, for a consumer to replace in
place. The value has no pattern to match: `scenarios.echoText` percent-encodes it,
and the route gets back what you passed.

### `/echo/bytes` — the value in a body that is not text

The request's `x-api-key` header between the bytes `00 01 FF`, as
`application/octet-stream`. Those bytes are not UTF-8, so a consumer cannot read the
body as text and write it back unchanged, and it is left with dropping it. Without
the header the answer is a 400.

The header is sent back as the bytes it arrived in. A browser sends `é` in a header
as the one byte `E9`, not as UTF-8. `echoBytesBody(value)` spells the whole body.

### `/echo/redirect?v=` — the value in a response header

A 302 to `/echo/text?v=<v>`, with `v` percent-encoded in `Location`.

## Pages that change on every read

For a consumer that captures the same page twice and compares the text
(capture-ledger's "changes since last time", CAPTURE-167). Each page counts
reads per `key`, and **the n-th read is a function of n alone** — nothing reads
the clock. The three pages differ in the kind of change, so a consumer can
write a different expectation for each. `POST /__reset` starts every `key` over.

### `/changing/news?key=` — a notice list that rotates one headline per read

Five dated headlines; each read drops the oldest and adds a new one. The
example of "the content changed".

### `/changing/dateline?key=` — a page where only the "updated" line moves

The body is the same on every read; only the line "更新: 2026-11-01 04:00"
moves one day per read. The example of "nothing a reader cares about changed".

### `/changing/injection?key=` — a page carrying an instruction for the reader of the difference

The "updated" line moves as on `/changing/dateline`, and from the second read
on the page adds a line addressed to an AI that reads the difference. A
consumer that has a language model read the difference uses it to check that
the model does not follow instructions found in the page's text.

## Pages that pick by a random draw

For a consumer that records the values page script received from
`Math.random`, `crypto.getRandomValues` and `crypto.randomUUID`, and a replay
viewer that hands them back (BrowserHive's `recordRandom`, CAPTURE-378). Each
page turns one draw into a number `n` in `0 … 999999`, appends one
`<img id="pick" src="/random/img/<n>.svg" alt="pick <n>">` and sets its title to
`pick <n>` (`src/random.ts`). Only the picked image is requested, so
`/__request-counts` says which number the page picked, and a replay that hands
the values back asks for the same image.

A number rather than a handful of colours: a replay that draws afresh picks the
same image by chance once in a million loads, not once in four.

:::caution[The number differs on every load]
Never hard-code it. Within one run, read what the capture picked from the
request log (or from the captured `#pick`), then hold the replay to that number.
:::

Every page is the baseline, `/random/pick`, with one thing changed: where the
draw comes from, when it happens, what ran before it, or where it runs.
Everything under `/random/` is sent `no-store`, so every load asks again for the
scripts and the image. The pages keep no state; `POST /__reset` has nothing of
theirs to clear.

### `/random/` — every page but one, for a crawl

Links to the thirteen pages below that need nothing but this fixture — all but
`/random/frame-other`, which needs a second origin. A crawl of depth 1 from here
reaches 14 pages.

### Pages a replay should hand back

| Page | Where the draw comes from |
|---|---|
| `/random/pick` | `Math.random`, once, in `/random/pick.js` — the baseline |
| `/random/uuid` | `crypto.randomUUID` (its first 32 bits), in `/random/uuid.js` |
| `/random/bytes` | `crypto.getRandomValues` (one `Uint32Array` word), in `/random/bytes.js` |
| `/random/late` | `Math.random` from a timer 300 ms after `/random/late.js` runs |
| `/random/two-scripts` | `/random/noise.js` draws 40 times and keeps nothing, then `/random/pick.js` picks: the page's 41st draw and its file's first |
| `/random/inline` | `Math.random` in an inline script — no script file |
| `/random/frame` | `/random/pick` in a same-origin iframe |
| `/random/busy?n=` | `/random/busy.js?n=` draws `n` times and keeps nothing, then picks: draw `n + 1` |

`n` on `/random/busy` is 0 to 2,000,000 (1,000 when left out); anything else is
a 400, as for every other count here. A large `n` is a page with far more draws
than any recorder would want to keep.

:::caution[`randomUUID` needs a secure context]
This fixture serves plain http, and a browser offers `crypto.randomUUID` only in
a secure context. Under any name but `localhost` (or `127.0.0.1`) the page has
no `randomUUID`; `/random/uuid.js` then sets the title to `no randomUUID` and
appends nothing. Load it from `localhost`, or in a browser told to treat the
origin as secure (Chrome's `--unsafely-treat-insecure-origin-as-secure`).
`getRandomValues` has no such limit.
:::

### Limit pages

Each of these is written to sit outside what a replay can be expected to hand
back. A test asserts what the consumer does there — records nothing, says so —
rather than a match.

| Page | What it does | Why it is a limit |
|---|---|---|
| `/random/frame-other?embedOrigin=` | `/random/pick` in an iframe served by `embedOrigin` | BrowserHive does not record a frame from another site, so nothing is recorded or handed back for it |
| `/random/racy` | draws `k` extra times on one line, `k = Math.floor(performance.now()) % 5`, then picks on another | the pick is always its own line, but how many draws came before it from the same file changes between loads |
| `/random/helper` | `/random/racy` with every draw made through `const r = () => Math.random();` | the extra draws and the pick all come from the same line, and their number changes between loads |
| `/random/time` | `n = Date.now() % 1000000` | the clock, not a random source |
| `/random/worker` | `/random/worker-pick.js` draws in a dedicated worker and posts `n` back | the draw is made in the worker, not in the page |

`embedOrigin` is required on `/random/frame-other` (400 without it), as on
`/links/iframe-other`, so the page cannot quietly turn into `/random/frame`. Only
a bare origin is accepted. Point it at another instance of this fixture.

### `/random/probe` — what the page saw, with no draw

Draws nothing. An inline script writes into `<pre id="probe">` the JSON of

```js
{
  mathRandom: String(Math.random),
  getRandomValues: String(crypto.getRandomValues),
  randomUUID: String(crypto.randomUUID),
  globals: Object.getOwnPropertyNames(window).sort(),
}
```

A built-in reads `function random() { [native code] }`; one a recorder replaced
reads otherwise, and a global it added shows in the list. The visible text is
what a capture keeps, so captures with and without the recorder, and the
replay, can be compared on it.

### `/random/img/:n.svg` — the picked image

The number as text, 320 × 80, the same bytes for the same `n`. Only the spelling
the pages write is answered — `0`, or digits with no leading zero, below
1,000,000. Anything else is a 404, the answer for an image that does not exist,
so a request log never holds two spellings of one pick.

## Introspection

Test-only endpoints. The request counts and the request log exist because
*how many times* something was requested, and with what, is often the actual
assertion — a retry test that only checks the final status cannot tell one
retry from five.

### `GET /__request-counts`

Request count per URL, as a plain object:

```json
{ "/plain-html": 1, "/fails-then-succeeds?failTimes=2&key=retry-budget": 3 }
```

Keyed by **full URL including the query string**, so `/fails-then-succeeds?failTimes=2&key=a` and
`/fails-then-succeeds?failTimes=2&key=b` count separately — the same isolation `key` gives you for
the failure counter.

### `GET /__requests`

The last `REQUEST_LOG_LIMIT` requests, oldest first, as a `RequestLog`:
`{ requests, truncated }`. Each entry is a `RecordedRequest` — the URL, the
method, the headers that explain caching (`ifNoneMatch`, `ifModifiedSince`,
`cacheControl`), `acceptLanguage`, `userAgent`, `host`, the headers a secret travels
in (`xApiKey`, `authorization`, `cookie`), and, for `/charset/echo` and
`/login/submit`, `bodySha256` and `bodyBytes`. `/login/submit` also carries the body
itself as `bodyText`. `truncated` turns true once the cap has dropped something.

The header values and `bodyText` are what arrived, in the clear, so send test values
only.

To count, use `/__request-counts`: past the cap, this log is no longer
everything.

### `POST /__reset`

Clears the hit counters, the flaky state, the read counts of the pages that
change on every read, the request log and the logins' notes.

Call it **between tests, not once per suite**. All of it lives in the server
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
