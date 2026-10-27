# Build engine/native/Dockerfile first. This derivative is for synthetic browser acceptance only.
ARG BASE_IMAGE=dreamcore-dh-b123:local
FROM ${BASE_IMAGE}
COPY tests/fixtures/native-browser-model.mjs /app/tests/fixtures/native-model.mjs
