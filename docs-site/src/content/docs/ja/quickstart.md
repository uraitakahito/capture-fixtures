---
title: クイックスタート
description: capture-fixtures をライブラリとして、またはコンテナとして動かし、別 VM のブラウザから到達させる
---

同じサーバを動かす方法が 2 つあります。
どちらが必要かは、**実ブラウザが到達する必要があるか**で決まります。

## ライブラリとして

ブラウザを介さずに HTTP の挙動を試すテスト向け。
`app.inject()` はプロセス内でアプリを叩くので、
**ソケットを開かず**、ポートの確保も要らず、後始末はアプリを閉じるだけです。

```ts
import { buildFixture, scenarios } from "capture-fixtures";

const app = buildFixture();

const res = await app.inject(scenarios.httpStatus(503));
// res.statusCode === 503

await app.close();
```

テストファイルごとに 1 つ作り、teardown で閉じてください。
`buildFixture()` は軽量です ― ルートを登録して返すだけで、
`listen()` を呼ぶまで何も待ち受けません。

:::caution[ライブラリ形態はブラウザに応答できません]
`app.inject()` はネットワークスタックに一切触れないので、**Chrome からは到達できません**。
`/lazy-images`・`/client-side-redirect`・`/cookie-banner` のように
**ブラウザ自身の挙動**が主題のシナリオには、コンテナが必要です。
:::

## コンテナとして

主経路です。キャプチャワーカーの Chrome は自分の VM で動くため、
capture-fixtures にはネットワーク越しに IP か DNS 名で到達できる必要があります。

```sh
container build -t capture-fixtures .
container run -d --name capture-fixtures capture-fixtures

# アドレスを調べて、起動を確認する
container ls
curl -sf http://<capture-fixtures-ip>:8080/health
```

Apple Container でプロジェクト DNS ドメインを使っている場合は名前で届きます ―
BrowserHive のスタックでは `capture-fixtures.browserhive:8080` です。

### 設定

環境変数が 2 つあります。コンテナのエントリポイント（`node dist/serve.js`）が
起動時に一度だけ読みます。

| 変数 | 既定値 | 備考 |
| --- | --- | --- |
| `CAPTURE_FIXTURES_PORT` | `8080` | 待ち受けポート |
| `CAPTURE_FIXTURES_HOST` | `0.0.0.0` | 別 VM から届くよう全インターフェースにバインド |

`0.0.0.0` という既定値こそが要点です。
ループバックにバインドしてしまうと**ブラウザの VM から到達できなくなり**、
コンテナで動かす意味そのものが失われます。
**どちらも変更する理由はほとんどありません** ― 利用側が前提にしているのは既定値です。

変更が必要な場合は、環境変数を渡す通常のやり方で渡します。

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
# チェックアウトから直接、コンテナなしで
pnpm run build && CAPTURE_FIXTURES_PORT=9090 pnpm start
```

**ライブラリとして使う場合、これらは読まれません。** `buildFixture()` は
起動していない Fastify アプリを返すだけで、環境変数には一切触れません
（読んでいるのは `serve.ts` だけです）。インプロセスのテストは `app.inject()` を
使うので待ち受け自体が発生せず、ソケットが要る場合は `app.listen()` に
自分で渡します。

## 起動を待つ

サーバが応答すること以外に準備完了の合図は無いので、`/health` をポーリングします。

```sh
until curl -sf "http://${CAPTURE_FIXTURES_IP}:8080/health" >/dev/null; do sleep 1; done
```

利用側は統合テストのセットアップでこれを行っています。
**コンテナの起動コマンドは、中のプロセスが待ち受けを始めるずっと前に戻る**からです。

## テストの書き方

利用側のテストが取る典型的な形です。

```ts
import { scenarios } from "capture-fixtures";

const origin = `http://${meadowIp}:8080`;

beforeEach(async () => {
  // リクエスト件数も失敗カウンタもプロセス内に残る。スイートごとではなく
  // テストごとにクリアする。
  await fetch(`${origin}/__reset`, { method: "POST" });
});

it("失敗するオリジンに対してリトライし、最終的に成功する", async () => {
  // このアサーション専用の key。並行するテストが同じ失敗予算を
  // 食い合わないようにする。
  await capture(origin + scenarios.failsThenSucceeds(2, "retry-until-success"));

  const hits = await (await fetch(`${origin}/__request-counts`)).json();
  expect(hits[scenarios.failsThenSucceeds(2, "retry-until-success")]).toBe(3);
});
```

各ルートが何を再現するのか、`key` がなぜ重要なのかは
[シナリオ](/scenarios/)にあります。

## 既定の実行から外す

前節のテストは、capture-fixtures が動いていなければ即座に失敗します。
**この種のテストを既定のテストコマンドに残さないでください。**
残すと、capture-fixtures と何の関係もないコードを触ったときまで、
コンテナの起動を強いられることになります。

テストランナーのプロジェクトを分けます。利用側は 2 つ持っています。

```ts
// vitest.config.mts
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: ["test/e2e/**"], // capture-fixtures を要求するものはここに集める
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

名前は慣習に従っただけです。実際に 2 つを分けている基準は
**プロセスの外に何かが起動している必要があるか**であって、
テストの粒度でも、速さでもありません。

そのうえで、既定のコマンドは片方だけを指すようにします。

```json
"test":     "vitest run --project unit",
"test:e2e": "vitest run --project e2e"
```

これで `npm test` は capture-fixtures 関連を*スキップする*のではなく、**そもそも収集しません**。
「0 skipped」を読み違える余地も、コンテナを起動し忘れる余地もありません。

### スキップではなく、失敗させる

`e2e` を**選んだ**のに capture-fixtures が動いていない場合は、失敗させます。

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

`it.skipIf()` のほうが手軽ですが、そのぶん質が落ちます。
**スキップしたテストは「通ったテスト」ではありません。** それでもレポートは緑です。
capture-fixtures の起動を忘れた CI が、何も検証しないまま成功を報告し続けます。
分離は**選ぶ**段階で行い、選んだ後は必ず結果を出します。

### CI

プルリクエストごとに回すのは `unit` だけにして、capture-fixtures を使うスイートは
手動起動にしておきます。日常の CI がコンテナを起動する理由はありません。

BrowserHive 側の「テストの実行」に、この構成が余さず書かれています ―
各コマンドが何を出力するか、E2E が落ちたときに何をするか、まで含めて。
あちらの docs は web に公開されていないので、BrowserHive のチェックアウトで
`pnpm run docs:local` を実行して読んでください。
