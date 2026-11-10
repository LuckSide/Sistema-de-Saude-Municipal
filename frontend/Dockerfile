FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY . .
RUN npm run build && rm -rf node_modules src public *.config.* tsconfig* index.html

FROM nginx:1.31-alpine-slim

# Ensure /run directory exists with proper permissions for nginx user
RUN mkdir -p /run && chown -R nginx:nginx /run

COPY --from=build /app/dist /usr/share/nginx/html

RUN apk update && apk upgrade --no-cache && rm -rf /var/cache/apk/* \
    && mkdir -p /var/cache/nginx/client_temp /var/log/nginx /var/lib/nginx /var/run \
    && chown -R nginx:nginx /var/cache/nginx /var/log/nginx /var/lib/nginx /var/run \
    && chmod -R 755 /var/cache/nginx /var/log/nginx /var/lib/nginx /var/run

COPY nginx.conf /etc/nginx/nginx.conf

USER nginx
EXPOSE 80