import { buildFixture } from "./fixture.js";

// Container entrypoint (`node dist/serve.js`). Binds 0.0.0.0 so a worker's
// Chrome in another VM can reach it by the container's IP.
const app = buildFixture();
const port = Number(process.env["CAPTURE_FIXTURES_PORT"] ?? "8080");
const host = process.env["CAPTURE_FIXTURES_HOST"] ?? "0.0.0.0";

try {
  const address = await app.listen({ host, port });
  app.log.info(`capture-fixtures fixture-origin listening on ${address}`);
} catch (err) {
  app.log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

// コンテナでは node が PID 1。PID 1 には既定の振る舞い（終了）しか持たない信号が届かないので、
// handler が無いと SIGTERM を無視し、猶予の後に SIGKILL で殺される（compose の down は 1 台 10 秒待つ）。
// 受け付けを閉じ、処理中の要求を終えてから 0 で終わる。閉じ切れないときは数秒で諦めて 1。
// 試験は test/serve.test.ts（子プロセスに信号を送る）。PID 1 としての確かめは .github/workflows/docker.yml の
// `docker stop` の step。
const HARD_EXIT_MS = 3_000;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    setTimeout(() => process.exit(1), HARD_EXIT_MS).unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}
