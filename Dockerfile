# One image: Express serves the API, the CDN stub and the built Angular app.

FROM node:24-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# The test cases page bundles this document from the repository root.
COPY TEST_CASES.md /app/TEST_CASES.md
RUN npx ng build

FROM node:24-alpine AS backend
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public
WORKDIR /app
COPY --from=backend /app/backend/package.json ./
COPY --from=backend /app/backend/node_modules ./node_modules
COPY --from=backend /app/backend/dist ./dist
COPY --from=frontend /app/frontend/dist/frontend/browser ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "dist/server.js"]
