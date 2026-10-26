# Local synthetic acceptance image. No production keys, business data or host
# filesystem are included. Pin the resulting image digest for every test run.
FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-fund --no-audit && npm cache clean --force
COPY tsconfig.json ./
COPY src/native/ ./src/native/
COPY profiles/ ./profiles/
COPY tests/native-wire-usage.test.mjs tests/native-model-gateway.test.mjs tests/native-budget.test.mjs tests/native-budget-stream.test.mjs tests/native-runtime.test.mjs tests/native-profile.test.mjs ./tests/
COPY tests/fixtures/native-model.mjs ./tests/fixtures/
COPY tests/integration/native-shell.mjs ./tests/integration/
COPY scripts/native-web-upgrade.mjs scripts/native-web-host.mjs scripts/native-web-runtime.mjs scripts/native-web-bridge.mjs ./scripts/
RUN npm run build
USER 1000:1000
ENV HOME=/tmp/dh-home NARB_DISABLE_NATIVE_CACHE=1
ENTRYPOINT ["node"]
CMD ["--test", "tests/native-wire-usage.test.mjs", "tests/native-model-gateway.test.mjs", "tests/native-budget.test.mjs", "tests/native-budget-stream.test.mjs", "tests/native-runtime.test.mjs", "tests/integration/native-shell.mjs", "tests/native-profile.test.mjs"]
