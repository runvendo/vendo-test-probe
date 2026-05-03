import { createServer } from "node:http";
import { URL } from "node:url";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

const VERSION = "0.2.0";
const TOOL = "vendo-test-probe";
const PORT = Number(process.env.PORT ?? 8080);
const MAX_SECONDS = 300;
const MAX_CPU = 4;
const MAX_BYTES = 10_000_000; // 10 MB ceiling for /proxy-test payloads
const MAX_DELAY_MS = 60_000;
const HEALTH_TIMEOUT_DELAY_MS = 10_000; // long enough to outlast a Worker fetch

// In-memory state for /healthz — flipped by PUT /healthz/mode. Resets on
// restart by design: tests own the probe lifecycle, so restart semantics
// are explicit.
const HEALTH_MODES = new Set(["ok", "500", "timeout"]);
let healthMode = "ok";

// Deterministic payload buffer, cached by size. Tests assert byte count
// rather than content so any fill byte works.
const payloadCache = new Map();
function payloadBuffer(bytes) {
  let buf = payloadCache.get(bytes);
  if (!buf) {
    buf = Buffer.alloc(bytes, 0x78); // 'x'
    payloadCache.set(bytes, buf);
  }
  return buf;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length === 0 ? {} : JSON.parse(raw);
}

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

    // PUT /healthz/mode — flip the in-memory health mode. Used by the
    // health-monitor lifecycle suite to simulate unhealthy / timing-out
    // deployments.
    if (req.method === "PUT" && url.pathname === "/healthz/mode") {
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        return json(res, 400, { error: "invalid JSON body" });
      }
      const { mode } = body ?? {};
      if (typeof mode !== "string" || !HEALTH_MODES.has(mode)) {
        return json(res, 400, {
          error: `mode must be one of ${[...HEALTH_MODES].join(", ")}`,
        });
      }
      healthMode = mode;
      return json(res, 200, { mode });
    }

    // /proxy-test — deterministic payload for the proxy request-path e2e
    // suite. Exercises byte metering, streaming, timing, and upstream error
    // passthrough without needing a real third-party provider. Accepts any
    // HTTP method so the proxy's method-passthrough tests (POST / PUT /
    // DELETE) can verify the upstream actually receives the verb the caller
    // sent. Request body is drained but ignored.
    if (url.pathname === "/proxy-test") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        // Drain the request body so the connection can close cleanly.
        for await (const _ of req) { /* discard */ }
      }
      const bytes = Number(url.searchParams.get("bytes") ?? 1024);
      const delayMs = Number(url.searchParams.get("delay_ms") ?? 0);
      const status = Number(url.searchParams.get("status") ?? 200);
      if (!Number.isInteger(bytes) || bytes < 0 || bytes > MAX_BYTES) {
        return json(res, 400, { error: `bytes must be integer 0..${MAX_BYTES}` });
      }
      if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_DELAY_MS) {
        return json(res, 400, { error: `delay_ms must be 0..${MAX_DELAY_MS}` });
      }
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        return json(res, 400, { error: "status must be a valid HTTP status" });
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      const body = payloadBuffer(bytes);
      res.writeHead(status, {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes),
      });
      if (req.method === "HEAD") {
        res.end();
      } else {
        res.end(body);
      }
      return;
    }

    if (req.method !== "GET") {
      return json(res, 405, { error: "method not allowed" });
    }

    if (url.pathname === "/") {
      return json(res, 200, { tool: TOOL, version: VERSION });
    }

    if (url.pathname === "/healthz") {
      if (healthMode === "500") return json(res, 500, { ok: false });
      if (healthMode === "timeout") {
        await new Promise((r) => setTimeout(r, HEALTH_TIMEOUT_DELAY_MS));
      }
      return json(res, 200, { ok: true });
    }

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
