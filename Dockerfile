FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node config*.json ./
COPY --chown=node:node tools ./tools
RUN node tools/build.mjs
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/signatures.sqlite
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
