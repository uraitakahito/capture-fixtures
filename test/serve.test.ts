import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * コンテナの entrypoint（dist/serve.js）の止め方。
 *
 * fixture.ts を import する試験では見えない —— 信号を受けるのは serve.ts の process で、動くのは dist。
 * wacz-signer の cli.test と同じ理由で、先に build してから子プロセスで起こす。
 *
 * handler が無いと子プロセスは信号で死ぬ（{ code: null, signal: "SIGTERM" }）。コンテナでは node が
 * PID 1 で、PID 1 には既定の振る舞いの信号が届かないので、handler 無しでは SIGTERM を無視して
 * 猶予の後に SIGKILL で殺される（compose の down は 1 台 10 秒待つ）。PID 1 の形は手元では再現できない
 * ので、ここで見るのは「受けたら閉じて 0 で終わる」ことだけ。PID 1 としての確かめは
 * .github/workflows/docker.yml の `docker stop` の step。
 */

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 空いている口を 1 つ借りる。開いて閉じるので、その間に取られる隙はあるが、試験には足りる。 */
const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("口の番号が取れない");
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  return address.port;
};

/** 条件が真になるまで 50 ms ごとに見る。期限を過ぎたら投げる。 */
const until = async (check: () => Promise<boolean>, ms: number): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`${String(ms)} ms 待っても条件が真にならない`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

/** 期限付きで待つ。期限の時計は、どちらが先でも止める。 */
const withTimeout = async <T>(promise: Promise<T>, ms: number, what: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${what}（${String(ms)} ms）`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** 127.0.0.1 なので、test/no-dns.ts の守り（名前を引かない）の中で済む。 */
const answers = (port: number): Promise<boolean> =>
  fetch(`http://127.0.0.1:${String(port)}/__version`).then(
    (res) => res.ok,
    () => false,
  );

describe("serve.js の止め方", () => {
  beforeAll(async () => {
    await execFileAsync("pnpm", ["run", "build"], { cwd: root });
  }, 180_000);

  it.each(["SIGTERM", "SIGINT"] as const)(
    "%s を受けたら、受け付けを閉じて終了コード 0 で終わる",
    async (signal) => {
      const port = await freePort();
      const child = spawn(process.execPath, ["dist/serve.js"], {
        cwd: root,
        stdio: "ignore",
        env: { ...process.env, CAPTURE_FIXTURES_HOST: "127.0.0.1", CAPTURE_FIXTURES_PORT: String(port) },
      });
      try {
        await until(() => answers(port), 5_000);
        const exited = once(child, "exit");
        child.kill(signal);
        const [code, sig] = (await withTimeout(exited, 2_000, "終わるのを待つ")) as [
          number | null,
          NodeJS.Signals | null,
        ];
        // handler が無いと { code: null, sig: "SIGTERM" }（信号で死ぬ）。
        expect({ code, sig }).toEqual({ code: 0, sig: null });
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    },
    15_000,
  );
});
