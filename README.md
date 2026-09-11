# capture-fixtures

A shared Fastify **fixture-origin** — the synthetic internet that Chrome visits
in [BrowserHive](https://github.com/uraitakahito/browserhive) and
[waggle](https://github.com/uraitakahito/waggle) integration tests. It controls
content, HTTP status, latency, per-key retry state, and request counts, so a
test can reproduce a timeout, a redirect chain, a lazy-loaded image or a flaky
origin on demand instead of hoping a real website obliges.

## Documentation

Everything — quickstart (library and container), every scenario and the failure
it reproduces, and development — lives on the docs site:

- **English** — <https://uraitakahito.github.io/capture-fixtures/>
- **日本語** — <https://uraitakahito.github.io/capture-fixtures/ja/>

## Related Projects

- [BrowserHive](https://github.com/uraitakahito/browserhive) — a web-capture server; capture-fixtures is what its E2E suite captures against (git submodule).
- [waggle](https://github.com/uraitakahito/waggle) — reads URLs from Postgres and drives BrowserHive.

## License

[Unlicense](./LICENSE).
