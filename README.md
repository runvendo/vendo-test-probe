# vendo-test-probe

Minimal HTTP probe for Vendo's Tier 3 integration tests. A real Railway deployment of this image lets the Vendo cron workers exercise their full path (metrics collection, billing rollup, health probing, suspension, teardown) against a disposable target that is cheap, deterministic, and safe to destroy.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Return tool name and version. |
| GET | `/healthz` | Liveness check used by the health-monitor worker. |
| GET | `/burn?seconds=N&cpu=M` | Spawn `M` worker threads (cap 4) that run a CPU-bound loop for `N` seconds (cap 300). Drives measurable Railway CPU metrics. Defaults: `seconds=5`, `cpu=1`. |
| ANY | `/proxy-test?bytes=N[&delay_ms=N][&status=N]` | Deterministic payload for the proxy e2e suite. Accepts any HTTP method so the proxy's method-passthrough tests can verify the upstream actually receives the verb. Request body is drained but ignored. |
| PUT | `/healthz/mode` | In-memory toggle (`{"mode":"ok"\|"500"\|"timeout"}`) used by the health-monitor lifecycle suite. |

Any other path returns 404 JSON. Non-GET requests on routes other than `/proxy-test` and `PUT /healthz/mode` return 405.

## Do not modify without updating the harness

This image is consumed by the Vendo testing harness (`testing/` in the main monorepo). Changing endpoint shapes, response bodies, or cap values will break those tests. If you need to extend it, coordinate with the harness changes in the same PR.

Published image: `ghcr.io/runvendo/vendo-test-probe:latest`.
