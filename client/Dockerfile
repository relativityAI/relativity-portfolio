FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# VITE_* values are baked into the bundle at build time — fail fast if .env is missing.
RUN test -s .env || { echo "client/.env missing — copy client/.env.example" >&2; exit 1; }
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
