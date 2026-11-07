import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFixture, type RequestLog } from "../src/fixture.js";
import { LOGIN_DEFAULT_USER, LOGIN_SUBMIT, loginSessionToken } from "../src/login-echo.js";
import { scenarios } from "../src/scenarios.js";
import { fetchOk } from "./helpers.js";

/** A value spelled differently in a URL, in a form's body, in JSON and in HTML. */
const VALUE = 'MARK p@ss+9z&é"<';
/** Its HTML spelling, written out: building it here would compare the escaping with itself. */
const VALUE_HTML = "MARK p@ss+9z&amp;é&quot;&lt;";
const VALUE_PERCENT = "MARK%20p%40ss%2B9z%26%C3%A9%22%3C";

const UTF8_HTML = "text/html; charset=utf-8";

let app: ReturnType<typeof buildFixture>;

beforeEach(() => {
  app = buildFixture();
});

afterEach(async () => {
  await app.close();
});

const postLogin = (payload: string, type: string = LOGIN_SUBMIT.type) =>
  app.inject({ method: "POST", url: LOGIN_SUBMIT.path, headers: { "content-type": type }, payload });

/** Logs in with `note`, and returns the cookie a browser would bring back. */
const login = async (note: string): Promise<string> => {
  const res = await postLogin(new URLSearchParams({ user: "u", password: "p", note }).toString());
  expect(res.statusCode).toBe(302);
  return `session=${loginSessionToken(note)}`;
};

const requestLog = async (): Promise<RequestLog["requests"]> =>
  (await fetchOk(app, "/__requests")).json<RequestLog>().requests;

describe("loginSessionToken", () => {
  it("spells the digest of the note, so a consumer's test can compute it", () => {
    // sha256("hello") is 2cf24dba5fb0a30e26e83b2ac5b9e29e…
    expect(loginSessionToken("hello")).toBe("session-2cf24dba5fb0a30e26e83b2a");
    // Taken over UTF-8: the digest of "é" is the digest of the bytes C3 A9.
    const utf8 = createHash("sha256").update(Buffer.from([0xc3, 0xa9])).digest("hex");
    expect(loginSessionToken("é")).toBe(`session-${utf8.slice(0, 24)}`);
  });

  // A token holding the note would vanish with it, and then a test could not tell
  // whether a consumer also took the cookie's own value for a secret. The hex note
  // is the one a careless token could be made of.
  it.each([VALUE, VALUE_PERCENT, VALUE_HTML, "hello-note", "abcdef0123456789"])(
    "does not contain the note %s",
    (note) => {
      expect(loginSessionToken(note)).not.toContain(note);
    },
  );

  it("is long enough for a consumer that asks for 8 characters before treating a value as a secret", () => {
    expect(loginSessionToken("x").length).toBeGreaterThanOrEqual(8);
  });

  it("differs from note to note, so two logins are two sessions", () => {
    expect(loginSessionToken("note-a")).not.toBe(loginSessionToken("note-b"));
  });
});

describe("/login/form", () => {
  it("is a form the browser posts to /login/submit, with user, password and note", async () => {
    const res = await fetchOk(app, scenarios.loginForm);
    expect(res.headers["content-type"]).toBe(UTF8_HTML);
    expect(res.body).toContain('<meta charset="utf-8">');
    // No enctype: the browser's default is the urlencoded body the route reads.
    expect(res.body).toContain(`<form id="form" method="post" action="${LOGIN_SUBMIT.path}">`);
    expect(res.body).toContain(`name="user" type="text" value="${LOGIN_DEFAULT_USER}"`);
    expect(res.body).toContain('id="password" name="password" type="password"');
    expect(res.body).toContain('id="note" name="note" type="text"');
    expect(res.body).toContain('<button id="go" type="submit">');
  });
});

describe("POST /login/submit", () => {
  it("answers 302 to /login/after and sets the session cookie loginSessionToken spells, with Path=/ alone", async () => {
    const res = await postLogin(new URLSearchParams({ user: "u", password: "p", note: VALUE }).toString());

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(scenarios.loginAfter);
    expect(res.headers["set-cookie"]).toBe(`session=${loginSessionToken(VALUE)}; Path=/`);
  });

  it("logs the body as it arrived, spelled as the browser sent it", async () => {
    const body = `user=${LOGIN_DEFAULT_USER}&password=${VALUE_PERCENT}&note=hello+note`;
    await postLogin(body);

    const [entry] = await requestLog();
    expect(entry).toMatchObject({
      url: LOGIN_SUBMIT.path,
      method: "POST",
      bodyText: body,
      bodySha256: createHash("sha256").update(body).digest("hex"),
      bodyBytes: Buffer.byteLength(body),
    });
  });

  it("decodes the form as a browser encodes it: + is a space and %XX is UTF-8", async () => {
    await postLogin("note=MARK+p%40ss%2B9z%26%C3%A9%22%3C");

    const after = await app.inject({
      url: scenarios.loginAfter,
      headers: { cookie: `session=${loginSessionToken(VALUE)}` },
    });
    expect(after.statusCode).toBe(200);
    expect(after.body).toContain(`welcome ${VALUE_HTML}`);
  });

  it("reads a body whose type carries a charset, as a fetch of URLSearchParams sends it", async () => {
    const res = await postLogin("note=hello", `${LOGIN_SUBMIT.type};charset=UTF-8`);
    expect(res.statusCode).toBe(302);
  });

  it.each([
    ["no note", "user=u&password=p"],
    ["an empty note", "user=u&password=p&note="],
  ])("refuses %s, sets no session, and still logs what arrived", async (_case, body) => {
    // A page with no value in it would pass a test that searches an archive for
    // the value, so a script that failed to type must hear about it.
    const res = await postLogin(body);

    expect(res.statusCode).toBe(400);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const [entry] = await requestLog();
    expect(entry?.bodyText).toBe(body);
  });

  it("refuses a POST with no body and no type at all", async () => {
    const res = await app.inject({ method: "POST", url: LOGIN_SUBMIT.path });
    expect(res.statusCode).toBe(400);
  });

  it("takes a long form and refuses what the log could not afford to keep", async () => {
    const accepted = await postLogin(`note=${"a".repeat(32 * 1024)}`);
    expect(accepted.statusCode).toBe(302);

    const refused = await postLogin(`note=${"a".repeat(128 * 1024)}`);
    expect(refused.statusCode).toBe(413);
    const entries = await requestLog();
    expect(entries.at(-1)).not.toHaveProperty("bodyText");
  });
});

describe("/login/after", () => {
  it("welcomes a browser that brought its cookie back with the note, HTML-escaped", async () => {
    const cookie = await login(VALUE);

    const res = await app.inject({ url: scenarios.loginAfter, headers: { cookie } });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe(UTF8_HTML);
    expect(res.body).toContain('<meta charset="utf-8">');
    expect(res.body).toContain(`welcome ${VALUE_HTML}`);
    expect(res.body).not.toContain(VALUE);
  });

  it("links on with a link that holds no value", async () => {
    const cookie = await login(VALUE);

    const res = await app.inject({ url: scenarios.loginAfter, headers: { cookie } });

    expect(res.body).toContain('<a href="/echo/text?v=plain">next</a>');
    expect((await fetchOk(app, scenarios.echoText("plain"))).body).toContain("plain");
  });

  it("finds the session among other cookies", async () => {
    const cookie = await login("hello");

    const res = await app.inject({ url: scenarios.loginAfter, headers: { cookie: `a=1; ${cookie}; b=2` } });

    expect(res.body).toContain("welcome hello");
  });

  it.each([
    ["no cookie", undefined],
    ["a cookie no login set", "session=session-000000000000000000000000"],
    // A real token, so only the cookie's name can be what refuses it.
    ["another cookie whose name ends in session", `not-session=${loginSessionToken("hello")}`],
  ])("refuses %s with a 403, and welcomes nobody", async (_case, cookie) => {
    await login("hello");

    const res = await app.inject({
      url: scenarios.loginAfter,
      headers: cookie === undefined ? {} : { cookie },
    });

    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("welcome");
  });

  it("keeps each login's note apart, in whichever order they land", async () => {
    const first = await login("note-a");
    const second = await login("note-b");

    const bodyFor = async (cookie: string): Promise<string> =>
      (await app.inject({ url: scenarios.loginAfter, headers: { cookie } })).body;

    expect(await bodyFor(first)).toContain("welcome note-a");
    expect(await bodyFor(second)).toContain("welcome note-b");
    expect(await bodyFor(first)).toContain("welcome note-a");
  });

  it("forgets every login on /__reset", async () => {
    const cookie = await login("hello");

    await app.inject({ method: "POST", url: "/__reset" });

    const res = await app.inject({ url: scenarios.loginAfter, headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });

  it("leaves the cookie it was brought in the request log, which is how a test sees it came back", async () => {
    const cookie = await login("hello");

    await app.inject({ url: scenarios.loginAfter, headers: { cookie } });

    const entries = await requestLog();
    expect(entries.at(-1)).toMatchObject({ url: scenarios.loginAfter, cookie });
  });
});

describe("/echo/text and /echo/json", () => {
  it("/echo/text repeats the value in a document, HTML-escaped", async () => {
    const res = await fetchOk(app, scenarios.echoText(VALUE));

    expect(res.headers["content-type"]).toBe(UTF8_HTML);
    expect(res.body).toContain(`<p id="echo">${VALUE_HTML}</p>`);
    expect(res.body).not.toContain(VALUE);
  });

  it("/echo/text escapes what would otherwise be markup", async () => {
    const res = await fetchOk(app, scenarios.echoText(`<script>'x'</script>`));

    expect(res.body).toContain("&lt;script&gt;&#39;x&#39;&lt;/script&gt;");
    expect(res.body).not.toContain("<script>");
  });

  it("/echo/json repeats the value as JSON, unchanged by the trip through the URL", async () => {
    const res = await fetchOk(app, scenarios.echoJson(VALUE));

    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.json()).toEqual({ v: VALUE });
  });
});

describe("the routes that repeat v", () => {
  it.each([
    ["/echo/text"],
    ["/echo/text?v="],
    ["/echo/json"],
    ["/echo/json?v="],
    ["/echo/redirect"],
    ["/echo/redirect?v="],
  ])("%s answers 400: with no value there is nothing for a test to search for", async (path) => {
    await fetchOk(app, path, 400);
  });
});

describe("/echo/bytes", () => {
  const NOT_TEXT = [0x00, 0x01, 0xff];
  const fetchBytes = (key: string) => app.inject({ url: scenarios.echoBytes, headers: { "x-api-key": key } });

  it("sends the header's value between bytes that are not text", async () => {
    const res = await fetchBytes("key-1");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    expect([...res.rawPayload]).toEqual([...NOT_TEXT, ...Buffer.from("key-1"), ...NOT_TEXT]);
  });

  it("cannot be read as UTF-8 and written back unchanged", async () => {
    const { rawPayload } = await fetchBytes("key-1");

    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(rawPayload)).toThrow();
    expect(Buffer.from(rawPayload.toString("utf8"), "utf8").equals(rawPayload)).toBe(false);
  });

  it("answers 400 with no header, and with an empty one", async () => {
    await fetchOk(app, scenarios.echoBytes, 400);
    expect((await fetchBytes("")).statusCode).toBe(400);
  });

  it("sends back the bytes a non-ASCII header arrived as", async () => {
    // inject() hands a header over as a string, so only a real connection has
    // bytes to compare. A browser sends é in a header as the one byte E9.
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    const body = await new Promise<Buffer>((resolve, reject) => {
      const req = httpRequest(
        { host: "127.0.0.1", port, path: scenarios.echoBytes, headers: { "x-api-key": "caf\xe9" } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            resolve(Buffer.concat(chunks));
          });
        },
      );
      req.on("error", reject);
      req.end();
    });

    expect([...body]).toEqual([...NOT_TEXT, 0x63, 0x61, 0x66, 0xe9, ...NOT_TEXT]);
  });
});

describe("/echo/redirect", () => {
  it("answers 302 with the value percent-encoded in Location", async () => {
    const res = await fetchOk(app, scenarios.echoRedirect(VALUE), 302);

    expect(res.headers.location).toBe(`/echo/text?v=${VALUE_PERCENT}`);
  });

  it("lands on a document that repeats the value", async () => {
    const { headers } = await fetchOk(app, scenarios.echoRedirect(VALUE), 302);

    const res = await fetchOk(app, String(headers.location));

    expect(res.body).toContain(VALUE_HTML);
  });
});
