# ghcr.io/orchard-suite/vantage: one image, four commands (web, worker, migrate, and connector run <id> for a runner).
# Build: docker build --platform linux/amd64 -t ghcr.io/orchard-suite/vantage .
# Bun 1.4.4 or later: 1.3.12 to 1.3.14 crash on Linux 7.0 kernels while suspending threads for GC (oven-sh/bun#31832).
FROM --platform=linux/amd64 oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY packages ./packages
COPY docs/agent-guide.md ./docs/agent-guide.md
COPY examples ./examples
RUN bun install --frozen-lockfile
RUN bun run build

FROM --platform=linux/amd64 oven/bun:1.4.4
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/bun.lock /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/docs ./docs
COPY --from=build /app/examples ./examples
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /data/blobs && chown -R bun:bun /data
USER bun
EXPOSE 4848
ENTRYPOINT ["/entrypoint.sh"]
CMD ["web"]
