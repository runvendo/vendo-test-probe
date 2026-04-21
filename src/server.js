import { createServer } from "node:http";
import { URL } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

const VERSION = "0.1.0";
const TOOL = "vendo-test-probe";
const PORT = Number(process.env.PORT ?? 8080);
const MAX_SECONDS = 300;
const MAX_CPU = 4;

if (!isMainThread) {
  parentPort.on("message", ({ untilMs }) => {
    while (Date.now() < untilMs) {
      Math.sqrt(Math.random() * 1e9);
    }
    parentPort.postMessage("done");
  });
} else {
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const burn = async (seconds, cpu) => {
    const untilMs = Date.now() + seconds * 1000;
    const workers = Array.from({ length: cpu }, () => new Worker(new URL(import.meta.url)));
    await Promise.all(
      workers.map(
        (w) =>
          new Promise((resolve) => {
            w.on("message", resolve);
            w.postMessage({ untilMs });
          }),
      ),
    );
    await Promise.all(workers.map((w) => w.terminate()));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
    if (url.pathname === "/") return json(res, 200, { tool: TOOL, version: VERSION });
    if (url.pathname === "/healthz") return json(res, 200, { ok: true });
    if (url.pathname === "/burn") {
      const seconds = Number(url.searchParams.get("seconds") ?? 5);
      const cpu = Number(url.searchParams.get("cpu") ?? 1);
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_SECONDS) {
        return json(res, 400, { error: `seconds must be integer 1..${MAX_SECONDS}` });
      }
      if (!Number.isInteger(cpu) || cpu < 1 || cpu > MAX_CPU) {
        return json(res, 400, { error: `cpu must be integer 1..${MAX_CPU}` });
      }
      await burn(seconds, cpu);
      return json(res, 200, { burned: { seconds, cpu } });
    }
    return json(res, 404, { error: "not found" });
  });

  server.listen(PORT, () => {
    console.log(`${TOOL} v${VERSION} listening on :${PORT}`);
  });
}
