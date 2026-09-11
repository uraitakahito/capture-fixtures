---
title: capture-fixtures
description: The synthetic internet that Chrome visits in BrowserHive and capture-ledger integration tests — a Fastify fixture-origin with deterministic failure modes
---

capture-fixtures is a small Fastify server that plays the part of **the internet** in
BrowserHive and
[capture-ledger](https://uraitakahito.github.io/capture-ledger/) integration tests.

## Why a fixture-origin exists

An integration test for a browser-based capture pipeline has to answer questions
like *"what happens when a page takes 40 seconds to respond?"* or *"does the
retry budget actually retry?"*. Pointing those tests at a real website answers
neither reliably:

- **A real site cannot be told to fail.** You cannot ask example.com for a 503,
  and you certainly cannot ask it for a 503 *the first two times and a 200 after
  that*.
- **A real site changes.** A test that passes today because a page happened to
  lazy-load an image below the fold fails next month when the site is
  redesigned — and the failure looks like a bug in the capture code.
- **A real site needs the network.** CI without egress, or with a slow link,
  turns a correctness test into a flakiness generator.

capture-fixtures removes all three. It serves pages **built to trigger one behaviour
each**, on demand, from inside the same network as the browser.

## One core, two shapes

The same `buildFixture()` app runs either way:

**As a library** — `import { buildFixture, scenarios } from "capture-fixtures"` and drive it
with `app.inject(...)`. No socket, no port, no cleanup beyond `app.close()`.
Right for anything that does not need a real browser.

**As a container** — run the image so a capture worker's Chrome, in a different
VM, reaches it by IP or DNS name. This is the primary path: the point of most
scenarios is what a *real browser* does with them, and a real browser needs a
real HTTP origin.

## What it is not

capture-fixtures is **not a mock**. It does not intercept requests or stub responses; it is
an ordinary HTTP server that really sends the bytes, really delays them, really
returns the status code. That is deliberate — stubbing at the network layer
would skip Chrome's own behaviour, which is exactly what these tests are about.

It is also **test-only**. `/__request-counts` and `/__reset` expose and mutate in-memory
state with no authentication whatsoever. Never run capture-fixtures where it can be
reached from outside the test network.

## Where to go next

- **[Quickstart](/quickstart/)** — run it as a library or as a container.
- **[Scenarios](/scenarios/)** — every route, and the failure each one reproduces.
- **[Development](/development/)** — build, test, and how consumers pin it.
