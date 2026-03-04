# Sulala Agent — gateway, watcher, scheduler, plugins. Dashboard built and served from gateway.
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Build backend (TypeScript → dist)
RUN npm run build

# Build dashboard so gateway can serve it
COPY dashboard ./dashboard
WORKDIR /app/dashboard
RUN npm ci 2>/dev/null || npm install
RUN npm run build
WORKDIR /app

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dashboard/dist ./dashboard/dist
COPY config ./config

ENV NODE_ENV=production
ENV PORT=2026
ENV HOST=0.0.0.0

EXPOSE 2026

CMD ["node", "dist/index.js"]
