FROM node:22.23.0-bookworm-slim
WORKDIR /app
COPY automation/package.json automation/package-lock.json ./automation/
RUN npm ci --prefix automation --ignore-scripts --no-audit --no-fund
COPY automation ./automation
COPY assets/js/tracker-source.js ./assets/js/tracker-source.js
RUN mkdir -p /state && chown node:node /state
USER node
ENV PW_WORKER_STATE=/state/worker.json PW_POLL_MS=60000 PORT=8788 API_ANYTHING_LOCAL_ONLY=1
EXPOSE 8788
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:8788/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","automation/worker.mjs"]
