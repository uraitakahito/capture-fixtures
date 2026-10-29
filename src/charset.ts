/**
 * Text whose bytes a consumer has to keep exactly as they were sent.
 *
 * A browser turns text into characters before anything else sees it. A
 * consumer that reads a body back as characters and writes it out again as
 * UTF-8 has changed it — invisibly for UTF-8, plainly for anything else. These
 * bodies are written so that the change shows: Shift_JIS declared in the
 * header, and UTF-8 with no charset at all, which a browser that hands a
 * fetched body back as text reads as windows-1252. The same stylesheet is read
 * twice, through `@import` and through `fetch()`: that is how a real page
 * (e-Gov's law search) came to be archived with one correct and one mangled
 * copy of the same file.
 *
 * Every body is served from this table and exported with it, so a test
 * compares an archive against the bytes that were sent rather than against a
 * copy of them.
 */

/** Shift_JIS for the two characters used here. Enough that no encoder is needed. */
const SHIFT_JIS = new Map<string, readonly number[]>([
  ["議", [0x8b, 0x63]],
  ["法", [0x96, 0x40]],
]);

/** `text` in Shift_JIS. ASCII passes through; any other character not in the table throws. */
const sjis = (text: string): Buffer =>
  Buffer.from(
    Array.from(text).flatMap((char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code < 0x80) return [code];
      const bytes = SHIFT_JIS.get(char);
      if (bytes === undefined) throw new Error(`no Shift_JIS for ${char}`);
      return bytes;
    }),
  );

const utf8 = (text: string): Buffer => Buffer.from(text, "utf8");

/** One body the `/charset/` page reads. */
export interface CharsetBody {
  /** The `Content-Type` it is served with, exactly. */
  readonly type: string;
  /** Sent with this content-coding when set. `body` is what is left once it is removed. */
  readonly encoding?: "gzip";
  /** The bytes, before any content-coding. */
  readonly body: Buffer;
}

/** What the page POSTs: Shift_JIS, labelled as such. */
export const CHARSET_ECHO = {
  path: "/charset/echo",
  type: "text/plain; charset=Shift_JIS",
  body: sjis("議法\n"),
} as const;

/**
 * The page. Reads every other body in the table: two stylesheets (one of them
 * `@import`s a third), an iframe, `fetch()` of five more, and a POST of
 * {@link CHARSET_ECHO}. The title changes once every read has settled.
 */
const pageHtml = (): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>charset</title>
<link rel="stylesheet" href="/charset/sjis.css">
<link rel="stylesheet" href="/charset/import.css">
</head><body>
<h1>議法</h1>
<p class="a">nocharset.css: </p>
<p class="b">sjis.css: </p>
<iframe src="/charset/sjis.html" title="sjis.html"></iframe>
<script>
const reads = ["/charset/sjis.css", "/charset/nocharset.css", "/charset/sjis.txt", "/charset/nocharset.txt", "/charset/gzip.css"]
  .map((path) => fetch(path).then((r) => r.arrayBuffer()));
const echo = fetch("${CHARSET_ECHO.path}", {
  method: "POST",
  headers: { "content-type": "${CHARSET_ECHO.type}" },
  body: new Uint8Array([${[...CHARSET_ECHO.body].join(", ")}]),
});
Promise.allSettled([...reads, echo]).then(() => { document.title = "charset read"; });
</script>
</body></html>
`;

// #region charset-fixtures
const fixtures = {
  /** The page itself: UTF-8, said so in a meta tag. Comes back unchanged either way. */
  "/charset/": { type: "text/html", body: utf8(pageHtml()) },
  /** The iframe's document. */
  "/charset/sjis.html": {
    type: "text/html; charset=Shift_JIS",
    body: sjis(`<!doctype html><meta charset="Shift_JIS"><title>sjis</title><p>議法</p>`),
  },
  /** A stylesheet, and fetched as well. */
  "/charset/sjis.css": { type: "text/css; charset=Shift_JIS", body: sjis(`.b::after{content:'議法'}`) },
  /** A stylesheet whose only rule imports the next one. ASCII, so it comes back unchanged either way. */
  "/charset/import.css": { type: "text/css", body: utf8(`@import url('/charset/nocharset.css');`) },
  /**
   * Imported, and fetched as well. `@charset` tells a stylesheet load it is
   * UTF-8; a fetch has only the header to go on, and the header says nothing.
   */
  "/charset/nocharset.css": { type: "text/css", body: utf8(`@charset "UTF-8";\n.a::after{content:'議法'}`) },
  /** Fetched. */
  "/charset/sjis.txt": { type: "text/plain; charset=Shift_JIS", body: sjis("議法\n") },
  /** Fetched. UTF-8, with no charset to say so. */
  "/charset/nocharset.txt": { type: "text/plain", body: utf8("議法\n") },
  /** Fetched, and sent gzipped. An archive keeps it decoded. */
  "/charset/gzip.css": { type: "text/css", encoding: "gzip", body: utf8(`.g::after{content:'議法'}`) },
} as const satisfies Readonly<Record<string, CharsetBody>>;
// #endregion

/** One of the paths of {@link CHARSET_FIXTURES}. */
export type CharsetPath = keyof typeof fixtures;

/** Every body under `/charset/`, by path. The server sends each one from here. */
export const CHARSET_FIXTURES: Readonly<Record<CharsetPath, CharsetBody>> = fixtures;
