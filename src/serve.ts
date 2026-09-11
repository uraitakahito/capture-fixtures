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
