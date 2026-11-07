import { createHash } from "node:crypto";

/**
 * Pages for testing that a consumer keeps a secret out of what it stores.
 *
 * A page that uses a secret has to send it, and the site it goes to can send it
 * back, so a secret travels further than the field it was typed into: the body
 * of a form, a cookie the login hands out, a document that greets the user, a
 * response header, a body that is not text. Each route here adds one of those
 * places, with a value the caller chose, so "is it still in the archive" can be
 * asked of each.
 *
 * Whether a value went out at all is read from the other end: `/__requests` keeps
 * the headers and the form's body as they arrived. Without that witness, an
 * archive with no value in it is also what a page that never sent one leaves
 * behind.
 *
 * The bodies are exported for the reason `CHARSET_FIXTURES` is: a test compares
 * an archive against what was sent rather than against a copy of it.
 */

/** Where `/login/form` posts. POST only, so it is not in `scenarios`, every entry of which a consumer can GET. */
export const LOGIN_SUBMIT = { path: "/login/submit", type: "application/x-www-form-urlencoded" } as const;

/**
 * What `/login/form`'s `user` field holds until something types over it. Not a
 * secret, so it is the control in the form's body: a consumer that replaced the
 * values it was told to still has this one.
 */
export const LOGIN_DEFAULT_USER = "fixture-user";

/**
 * The session `POST /login/submit` hands out for `note`. Spelled here for the
 * reason `markedTokens` is: a consumer's test computes it rather than copying its
 * spelling.
 *
 * A digest, because no part of it may be the note. A consumer that hides the note
 * replaces it wherever it is spelled, so a token holding the note would vanish
 * along with it, and a test could no longer tell whether the consumer also took
 * the cookie's own value for a secret. It is far longer than the 8 characters a
 * consumer may ask of a value before treating it as one.
 */
export const loginSessionToken = (note: string): string =>
  `session-${createHash("sha256").update(note, "utf8").digest("hex").slice(0, 24)}`;

/**
 * The characters a template engine escapes, `&` first so the others' entities
 * stay as written. A site that repeats a value spells it this way, which is one
 * more spelling a consumer has to find.
 */
const escapeHtml = (text: string): string =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const pageHtml = (title: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>
${body}
</body></html>`;

/**
 * A form a browser submits itself, so the POST is a navigation of the page rather
 * than a request its script made. The meta charset matters here: a browser encodes
 * what was typed in the document's encoding, and the note's digest is over UTF-8.
 */
export const LOGIN_FORM_HTML = pageHtml(
  "login",
  `<h1>login</h1>
<form id="form" method="post" action="${LOGIN_SUBMIT.path}">
<label>user <input id="user" name="user" type="text" value="${LOGIN_DEFAULT_USER}"></label>
<label>password <input id="password" name="password" type="password"></label>
<label>note <input id="note" name="note" type="text"></label>
<button id="go" type="submit">log in</button>
</form>`,
);

/**
 * Where a login lands. The value is here once, so a consumer can count what it
 * replaced. The link holds no value: a consumer that leaves out links holding a
 * secret still has this one, and an empty list would not say whether it read any.
 */
export const loginAfterHtml = (note: string): string =>
  pageHtml(
    "after login",
    `<p id="welcome">welcome ${escapeHtml(note)}</p>
<a href="/echo/text?v=plain">next</a>`,
  );

/** What `/login/after` sends to a browser that did not bring a session back. */
export const LOGIN_REFUSED_HTML = pageHtml("not logged in", "<h1>not logged in</h1>");

/** A document that repeats `v`, once. */
export const echoTextHtml = (v: string): string => pageHtml("echo", `<p id="echo">${escapeHtml(v)}</p>`);

/** A NUL and a byte UTF-8 never uses, so this cannot be read as text and written back unchanged. */
const NOT_TEXT = Buffer.from([0x00, 0x01, 0xff]);

/**
 * `value` between bytes that are not text. Latin1 because that is how Node hands
 * over a header's bytes, so this writes back the bytes that arrived. UTF-8 would
 * turn a non-ASCII value into bytes the request never carried.
 */
export const echoBytesBody = (value: string): Buffer =>
  Buffer.concat([NOT_TEXT, Buffer.from(value, "latin1"), NOT_TEXT]);
