/**
 * A homepage built the old way: a `<frameset>` with a menu on the left and the
 * page on the right, and a photograph of a face on the right (CAPTURE-147).
 *
 * Two things are tried against it. A capture that copies each child frame's
 * document as it was drawn has to find the documents inside `<frame>`, not
 * only the top one — and here the top document holds nothing but the frameset.
 * A script run in the capture's page that looks for faces (capture-scripts'
 * `face-mustache`) has to reach into the right-hand frame to find the photo.
 *
 * Every reference is relative (`menu.htm`, `top.htm`, `mona.jpg`), as on the
 * pages this imitates, so the pages only work under `/portrait/`; `/portrait`
 * is redirected there (see `fixture.ts`). Nothing here refers to another host.
 *
 * The photograph is `site/portrait/mona.jpg`: "Mona Lisa, by Leonardo da Vinci,
 * from C2RMF retouched" from Wikimedia Commons, scaled to 500 px wide. The
 * painting and the photograph are in the public domain (PD-Art). The server
 * reads the file once, when it is built.
 */

/** One body under `/portrait/`. */
export interface PortraitFile {
  readonly type: string;
  readonly body: string;
}

const HTML = "text/html";

/** The top document: the frameset, and nothing else to see. */
const INDEX = `<html>
<head>
<meta charset="utf-8">
<title>肖像のホームページ</title>
</head>
<frameset cols=18,82>
  <frame src="menu.htm" marginheight="0" marginwidth="0" scrolling="auto" name="left">
  <frame src="top.htm" marginheight="0" marginwidth="0" scrolling="auto" name="right">
  <noframes><body></body></noframes>
</frameset>
</html>
`;

/** The left frame. Its one link opens `top.htm` in the right frame. */
const MENU = `<html><head><meta charset="utf-8"><title>menu</title></head>
<body bgcolor="#eeeeff"><br><ul><li><a href="top.htm" target="right">トップ</a><li>作品<li>展示<li>English</ul></body></html>
`;

/** The right frame: the photograph, drawn smaller than the file (500 × 745), and its caption. */
const TOP = `<html><head><meta charset="utf-8"><title>肖像のホームページ</title></head>
<body>
<br>
<h1 align="center">肖像のホームページ</h1>
<table align="center">
  <tr>
    <td rowspan="2"><img src="mona.jpg" width="350" height="522" border="0"><br><br>
      モナ・リザ（Leonardo da Vinci・1503 年ごろ）<br>
      絵は Wikimedia Commons の public domain の複製（C2RMF）
    </td>
    <td valign="top">★★★ 最新情報 ★★★<hr>
      <ul><li>ルーヴル美術館 所蔵<li>フレームの中の文書の写しと、顔を見つけるスクリプトを試す頁です</ul>
    </td>
  </tr>
</table>
</body></html>
`;

/** Every document under `/portrait/`, by path. The server sends each one from here. */
export const PORTRAIT_FILES: Readonly<Record<string, PortraitFile>> = {
  "/portrait/": { type: HTML, body: INDEX },
  "/portrait/menu.htm": { type: HTML, body: MENU },
  "/portrait/top.htm": { type: HTML, body: TOP },
};

/** The photograph: where it is served, and where it lives under `site/`. */
export const PORTRAIT_IMAGE = { path: "/portrait/mona.jpg", site: ["portrait", "mona.jpg"], type: "image/jpeg" } as const;
