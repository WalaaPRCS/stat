FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY worker ./worker
COPY drizzle ./drizzle
COPY web ./web
RUN node server/build.mjs && mkdir -p /app/storage && chown -R node:node /app/storage
USER node
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/storage
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/index.mjs"]
