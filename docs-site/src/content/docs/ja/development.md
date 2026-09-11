---
title: 開発
description: capture-fixtures のビルドとテスト、利用側からの submodule としての参照、シナリオを足すときに気をつけること
---

## コマンド

```sh
pnpm run check   # typecheck + lint + test
pnpm run build   # dist/ を出力
pnpm start       # dist/serve.js を実行
```

CI が回すのは `pnpm run check` です。
`build` が別なのは、利用側が `dist/` から import するからです（後述）。

## 利用側からの使われ方

capture-fixtures は BrowserHive と waggle の両方で **git submodule** として参照されており、
npm の依存ではありません。それぞれが特定のコミットを固定しているので、
ここでの変更は**利用側がポインタを意図的に進めるまで届きません**。

これには知っておくべき帰結があります。capture-fixtures の `package.json` には
**`prepare` スクリプトがありません**。
かつては install 時にビルドして利用側が `dist/` をただで得られるようにしていましたが、
submodule はソースがビルドされないままチェックアウトされ、
しかも `prepare` が **`tsc` の無い状況で発火**しました
― 開発依存を落とした Docker のビルドステージが典型例です。
現在は利用側が自分のビルドの一部として capture-fixtures を明示的にビルドします。

## シナリオを足す

3 か所を、この順に。

1. **`src/fixture.ts`** ― ルート本体
2. **`src/scenarios.ts`** ― 型付きのエントリ。`// #region scenarios` マーカーの内側に。
   利用側にパスを直書きさせてはいけません
3. **[シナリオ](/scenarios/)** ― **なぜ**それが存在するのか

飛ばされがちなのは 3 で、そして重要なのも 3 です。
**目的が書かれていないルートは、誰も消せないルートになります** ―
次の人には「何を返すか」は読めても、
「消したら何が壊れるのか」が分からないからです。

:::caution[`#region` マーカーは機能の一部です]
シナリオのページは、ビルド時に `src/scenarios.ts` の
`// #region scenarios` から `// #endregion` までを取り込んでいます。
このコメントを消したり名前を変えたりすると**ドキュメントのビルドが落ちます** ―
意図的にそうしてあります。
存在しないコードを載せたページが作られないようにするためです。
:::

### よいシナリオの条件

各ルートは**ひとつ**の失敗モードを、**決定論的に**再現すべきです。
`/fails-then-succeeds` が手本です。名前そのものが挙動を言い切っており、
`failTimes` が回数を、`key` がカウンタの分離を担います。
**直前に何が走ったかで挙動が変わるシナリオは、無いほうがましです** ―
不安定さをテストしているように見えながら、
利用側のテストを不安定にするだけだからです。

共有状態が要るなら key で分けること。タイミングが要るなら定数ではなく引数にすること。

## ドキュメント

```sh
pnpm run site:dev     # ローカルプレビュー
pnpm run site:check   # ビルド + 参照がすべて解決することを検証
```

`site:check` は全プルリクエストの CI で走ります。
ビルドだけでは見つからない 2 種類のずれを捕まえます。

- コードフェンスの `file=` 属性が、名前を変えられた region を指している
- 本文中に書かれた `src/` のパスが、移動されたファイルを指している

どちらも同じ失敗です ―
**消えたコードを説明しているのに、ビルドは緑のまま通るドキュメント**です。

ページは `docs-site/src/content/docs/`（英語）と `.../ja/`（日本語）にあります。
**両ロケールは同時に更新してください。**
未翻訳の日本語ページは黙って英語にフォールバックするので、
**判断ではなく見落としとして読まれます**。

## コンテナ

```sh
container build -t capture-fixtures .
container run -d --name capture-fixtures capture-fixtures
```

Dockerfile は 3 ステージです。TypeScript はフルイメージでコンパイルし、
本番依存は専用のステージに入れ、実行用イメージは前者から `dist/`、
後者から `node_modules/` を受け取って `site/` を足します。

本番依存に専用ステージを割くのは、ビルドステージの上で削る方法が使えないためです。
dev を含む node_modules に対する `pnpm install --prod` は書き換えになり、
そのレイヤの commit でビルダが数分固まります。`pnpm deploy` も使えません ―
workspace から project を選ぶコマンドで、この repo は workspace package を宣言しません。

pnpm を使う 2 つのステージは corepack を明示的に入れています。Node 25 で本体から
分離されたため `node:26` では `corepack enable` だけでは失敗し、しかも
`package.json` の `packageManager` とその hash を読むのは corepack だからです。
