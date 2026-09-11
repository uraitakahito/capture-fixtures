---
title: Quickstart
description: Run capture-fixtures as an in-process library or as a container, and reach it from a browser in another VM
---

Two ways to run the same server. Which one you want depends on whether a **real
browser** has to reach it.

## As a library

For tests that exercise HTTP behaviour without a browser. `app.inject()` drives
the app in-process — no socket is opened, so there is no port to allocate and
nothing to clean up but the app itself.

```ts
import { buildFixture, scenarios } from "capture-fixtures";

const app = buildFixture();

const res = await app.inject(scenarios.httpStatus(503));
// res.statusCode === 503

await app.close();
```

Build one app per test file and close it in teardown. `buildFixture()` is cheap
— it registers routes and returns; nothing listens until you call `listen()`.

:::caution[A library instance cannot serve a browser]
`app.inject()` never touches the network stack, so Chrome cannot reach it. If a
scenario is about what the *browser* does — `/lazy-images`, `/client-side-redirect`,
`/cookie-banner` — you need the container.
:::

## As a container

The primary path. A capture worker's Chrome runs in its own VM, so capture-fixtures has
to be reachable over the network by IP or DNS name.

```sh
container build -t capture-fixtures .
container run -d --name capture-fixtures capture-fixtures

# Find the address, then check it is up
container ls
curl -sf http://<capture-fixtures-ip>:8080/health
```

Under Apple Container with a project DNS domain, consumers reach it by name
instead — BrowserHive's stack runs it as `capture-fixtures.browserhive:8080`.

### Configuration

Two environment variables, read once at startup by the container entrypoint
(`node dist/serve.js`):

| Variable | Default | Notes |
| --- | --- | --- |
| `CAPTURE_FIXTURES_PORT` | `8080` | Port to listen on |
| `CAPTURE_FIXTURES_HOST` | `0.0.0.0` | Binds all interfaces so another VM can reach it |

`0.0.0.0` is the point of the default: binding loopback would make the container
unreachable from the browser VM, which is the whole reason the container exists.
**There is rarely a reason to change either one** — the defaults are what the
consumers expect.

If you do need to, pass them the way you pass any environment variable.

```sh
# container / docker
container run -d --name capture-fixtures -e CAPTURE_FIXTURES_PORT=9090 capture-fixtures
```

```yaml
# compose
services:
  capture-fixtures:
    build: ./capture-fixtures
    environment:
      CAPTURE_FIXTURES_PORT: "9090"
```

```sh
# straight from a checkout, no container
pnpm run build && CAPTURE_FIXTURES_PORT=9090 pnpm start
```

**As a library, these are ignored.** `buildFixture()` returns an unstarted
Fastify app and never touches the environment; `serve.ts` is the only reader.
In-process tests use `app.inject()` and never listen at all, and if you do want
a socket, pass what you want to `app.listen()` yourself.

## Waiting for it

There is no readiness signal beyond the server answering, so poll `/health`:

```sh
until curl -sf "http://${CAPTURE_FIXTURES_IP}:8080/health" >/dev/null; do sleep 1; done
```

Consumers do this in their integration-test setup rather than assuming the
container is up — starting a container returns long before the process inside
is listening.

## Writing a test against it

The shape most consumer tests take:

```ts
import { scenarios } from "capture-fixtures";

const origin = `http://${meadowIp}:8080`;

beforeEach(async () => {
  // Both request counts and failure counters are per-process — clear them per test,
  // not per suite.
  await fetch(`${origin}/__reset`, { method: "POST" });
});

it("retries a flaky origin until it succeeds", async () => {
  // A key unique to this assertion, so a parallel test cannot consume the
  // same failure budget.
  await capture(origin + scenarios.failsThenSucceeds(2, "retry-until-success"));

  const hits = await (await fetch(`${origin}/__request-counts`)).json();
  expect(hits[scenarios.failsThenSucceeds(2, "retry-until-success")]).toBe(3);
});
```

See [Scenarios](/scenarios/) for what each route reproduces, and why `key`
matters.

## Keeping these tests out of the default run

The test above fails the moment capture-fixtures is not running. **Do not leave that kind
of test in the default test command.** If you do, every change to anything —
including code that has nothing to do with capture-fixtures — starts requiring a
container.

Split them into their own test-runner project instead. Consumers use two:

```ts
// vitest.config.mts
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**"], // everything that needs capture-fixtures lives here
        },
      },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.e2e.test.ts"],
          globalSetup: ["./test/e2e/global-setup.ts"],
        },
      },
    ],
  },
});
```

The names are only convention: what actually separates the two is whether a
test needs something running outside the process — not how fine-grained it is,
and not how fast it runs.

Then point the default command at only one of them:

```json
"test":     "vitest run --project unit",
"test:e2e": "vitest run --project e2e"
```

Now `npm test` does not *skip* the capture-fixtures tests — it never collects them. There
is no "0 skipped" line to misread, and no container to remember.

### Fail, do not skip

When the `e2e` project **is** selected and capture-fixtures is not up, fail:

```ts
// test/e2e/global-setup.ts
const READY_ATTEMPTS = 45;

let reachable = false;
for (let i = 0; i < READY_ATTEMPTS && !reachable; i++) {
  reachable = await fetch(`${origin}/health`)
    .then((r) => r.ok)
    .catch(() => false);
  if (!reachable) await new Promise((r) => setTimeout(r, 1000));
}
if (!reachable) {
  throw new Error(`capture-fixtures not reachable at ${origin} after 45s — start it first`);
}
```

`it.skipIf()` is easier and worse. **A skipped test is not a passing test**, but
it reports as green — so a CI job that forgets to start capture-fixtures keeps reporting
success while verifying nothing. Do the separating when the suite is *chosen*,
and once chosen, always produce a result.

### CI

Run `unit` on every pull request and leave the capture-fixtures suite on manual dispatch.
There is no reason for day-to-day CI to start a container.

BrowserHive's own "Running the tests" page is this arrangement written out in
full, including what each command reports and what to do when an E2E test fails.
Those docs are not published on the web — build them from the BrowserHive
checkout with `pnpm run docs:local`.
