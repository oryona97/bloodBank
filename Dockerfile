FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY server/migrations ./server/migrations

USER node
EXPOSE 3001
CMD ["sh", "-c", "node dist/server/server/scripts/migrate.js && exec node dist/server/server/src/index.js"]
