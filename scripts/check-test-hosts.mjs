/**
 * Watches the test files for example names. Test hostnames use .test, the names RFC 2606 keeps
 * for testing (site.test, other-site.test, a.test, ...).
 *
 * ## Why
 *
 * Example names (example.com, .org, .net and the names under them, *.example) are for
 * documentation, and their answers differ by network. In 2026-10 the LAN router (an Aterm)
 * answered example.com with 127.0.0.1, and a browserhive unit test failed only locally.
 * test/no-dns.ts catches a test that looks a name up; it does not catch writing one, and
 * example.com has been written into tests for a long time.
 *
 * ## What it reads
 *
 * Text files tracked by git under SCOPES (the tests, and what the tests read). Four shapes:
 * example.com and friends, their SURT (com,example), *.example, and its SURT (example,a).
 * A regular expression's \. counts as the same name.
 *
 * ## What it does not read
 *
 * Docs, source comments and UI placeholders: example names are for documentation, which is
 * where they belong. .env.example (a file name, not a host) and non-text files such as zips.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Where this repo keeps its tests. The only line that differs between repos. */
const SCOPES = ["test"];

const FIND = [
  // example.com, .org, .net and the names under them (www.example.com, someone@example.com, example\.com)
  /(?<![A-Za-z0-9-])example\\{0,2}\.(?:com|org|net)(?![A-Za-z0-9-])/i,
  // their SURT (com,example,www)/)
  /(?<![A-Za-z0-9-])(?:com|org|net),example(?![A-Za-z0-9-])/i,
  // *.example (a.example, *://*.example/*), leaving .env.example alone
  /(?:^|[^A-Za-z0-9.-])(?!env\\{0,2}\.example)(?:[A-Za-z0-9-]+|\*)(?:\\{0,2}\.[A-Za-z0-9-]+)*\\{0,2}\.example(?![A-Za-z0-9.-])/i,
  // its SURT (example,a)/)
  /(?<![A-Za-z0-9-])example,[A-Za-z0-9-]+[),]/i,
];

const files = execFileSync("git", ["ls-files", "--", ...SCOPES], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
let found = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (text.includes("\u0000")) continue;
  text.split("\n").forEach((line, index) => {
    if (FIND.some((re) => re.test(line))) {
      found++;
      console.error(
        `${file}:${index + 1}: an example name is left (use a .test name such as site.test): ${line.trim()}`,
      );
    }
  });
}
if (found > 0) process.exit(1);
console.log(`No example names in the test files (${files.length} files)`);
