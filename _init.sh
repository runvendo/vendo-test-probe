#!/usr/bin/env bash
set -euo pipefail
cd /tmp/vendo-test-probe
git add .
git -c user.email=yousef@vendo.run -c user.name=yousefh409 commit -m "feat: initial probe - healthz and deterministic CPU burn"
git push -u origin main
