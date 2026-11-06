# Chaperone risk checker for an Intel TDX confidential VM (dstack / Phala Cloud).
# Build context: deploy/tee, containing checker-tee.mjs (bundled by CI, see .github/workflows/checker-image.yml).
# The image runs only the bundled checker; its signing key is generated in enclave memory at boot.
FROM node:22-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
WORKDIR /app
COPY checker-tee.mjs ./
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["node", "checker-tee.mjs"]
