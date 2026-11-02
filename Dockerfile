# ── Build the frontend ─────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY frontend frontend
RUN npm run build --workspace=frontend

# ── Runtime: backend serves the API and the built frontend ─────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace=backend && npm cache clean --force
COPY backend backend
COPY --from=build /app/frontend/dist frontend/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
CMD ["node", "backend/server.js"]
