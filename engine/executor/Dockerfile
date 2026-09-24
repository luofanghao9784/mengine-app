# Build requires an operator-verified immutable official Node base digest.
ARG NODE_IMAGE=node@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e
FROM ${NODE_IMAGE}
USER root
RUN mkdir -p /job/inputs /job/modules/candidate /job/outputs /opt/dreamcore && chmod 755 /job /job/inputs /job/modules /job/modules/candidate /job/outputs
COPY --chmod=0444 runner.mjs /opt/dreamcore/runner.mjs
USER 65532:65532
WORKDIR /job/outputs
ENTRYPOINT ["node", "/opt/dreamcore/runner.mjs"]
