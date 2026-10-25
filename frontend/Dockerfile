# Sentiora web dashboard: static build served by unprivileged nginx, which also
# reverse-proxies /api and /health to the backend so the app is same-origin.
# Build context is the repository root (npm workspaces):
#   docker build -f frontend/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY extension/package.json extension/package.json
COPY shared/package.json shared/package.json
RUN npm ci --workspace frontend --include-workspace-root --ignore-scripts

COPY tsconfig.base.json ./
COPY shared ./shared
COPY frontend ./frontend

# Empty = same-origin relative API calls (/api/v1) through the nginx proxy.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build --workspace frontend


FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY infrastructure/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/nginx-health >/dev/null || exit 1
