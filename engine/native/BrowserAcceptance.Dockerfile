# Build engine/native/Dockerfile first. This derivative is for synthetic browser acceptance only.
ARG BASE_IMAGE=dreamcore-dh-b123:local
FROM ${BASE_IMAGE}
USER 0:0
COPY src/native/ /app/src/native/
COPY scripts/native-*.mjs /app/scripts/
COPY profiles/ /app/profiles/
COPY native/preinstalled-plugins.json /app/native/preinstalled-plugins.json
RUN npm run build
USER 1000:1000
COPY tests/fixtures/native-browser-model.mjs /app/tests/fixtures/native-model.mjs
