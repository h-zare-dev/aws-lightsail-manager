# Build TypeScript in CI, not on deployment host.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
COPY test ./test
RUN npm run check && npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/h-zare-dev/aws-lightsail-manager"
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts ./scripts
USER node
CMD ["node", "dist/index.js"]
