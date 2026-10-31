/**
 * Keeps unit tests off the real DNS. Vitest loads it through setupFiles; node --test through --import.
 *
 * Only names whose answers RFC 6761 fixes may be looked up:
 *   - IP literals (no lookup) and localhost (§6.3; the OS hosts file answers)
 *   - *.invalid (§6.4; answered "no such name" without asking the network)
 * Any other name is answered "no such name" and recorded, and the test that asked fails in afterEach.
 * It records instead of throwing inside lookup because a caller may swallow a lookup failure
 * (browserhive's checkCaptureAddress lets an unresolvable name through). A test that needs an
 * answer injects it with vi.mock("node:dns/promises").
 *
 * The same file lives in 6 repos (browserhive, capture-ledger, capture-scheduler, capture-fixtures,
 * dashboard, wacz-validator); this repo keeps its comments in English. Change all six together.
 */
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { syncBuiltinESMExports } from "node:module";
import { isIP } from "node:net";

type Lookup = (this: unknown, host: string, ...rest: unknown[]) => unknown;
interface State {
  refused: string[];
  installed: boolean;
}

// Vitest reloads setup files for every test file, so the state is kept once per process
// (Symbol.for returns the same key across reloads).
const scope = globalThis as unknown as Record<symbol, State | undefined>;
const state = (scope[Symbol.for("crawler.no-dns")] ??= { refused: [], installed: false });

/** "pass" goes to the real lookup; "nxdomain" answers "no such name" without asking the network. */
const decide = (host: string): "pass" | "nxdomain" | "refuse" => {
  if (isIP(host) !== 0) return "pass";
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost") return "pass";
  if (name === "invalid" || name.endsWith(".invalid")) return "nxdomain";
  return "refuse";
};

const notFound = (host: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
    code: "ENOTFOUND",
    syscall: "getaddrinfo",
    hostname: host,
  });

if (!state.installed) {
  state.installed = true;
  // dns.lookup, the callback form (net, http and fetch go through it).
  const callbackApi = dns as unknown as { lookup: Lookup };
  const callbackLookup = callbackApi.lookup;
  callbackApi.lookup = function lookup(host, ...rest) {
    const verdict = decide(host);
    if (verdict === "pass") return callbackLookup.call(this, host, ...rest);
    if (verdict === "refuse") state.refused.push(host);
    process.nextTick(rest.at(-1) as (error: Error) => void, notFound(host));
    return {};
  };
  // The lookup of dns/promises (browserhive's src imports this one).
  for (const api of new Set([dnsPromises, dns.promises]) as Set<unknown>) {
    const promiseApi = api as { lookup: Lookup };
    const promiseLookup = promiseApi.lookup;
    promiseApi.lookup = function lookup(host, ...rest) {
      const verdict = decide(host);
      if (verdict === "pass") return promiseLookup.call(this, host, ...rest);
      if (verdict === "refuse") state.refused.push(host);
      return Promise.reject(notFound(host));
    };
  }
  // Let `import { lookup } from "node:dns/promises"` see the replacement too.
  syncBuiltinESMExports();
}

const { afterEach } = process.env["VITEST"] ? await import("vitest") : await import("node:test");
afterEach(() => {
  const names = state.refused.splice(0);
  if (names.length > 0) {
    throw new Error(
      `A unit test looked up a real name: ${[...new Set(names)].join(", ")} — inject the answer in the test (vi.mock("node:dns/promises"))`,
    );
  }
});
