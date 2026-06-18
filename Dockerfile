FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates chromium chromium-driver \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force

COPY bin ./bin
COPY src ./src

RUN mkdir -p /app/config /app/var

COPY config/secrets.example.json ./config/secrets.example.json

RUN chown -R node:node /app

USER node

ENTRYPOINT ["node", "/app/bin/zyxel-nr5101-watchdog.js"]
CMD ["watch", "--config", "/app/config/secrets.json"]
