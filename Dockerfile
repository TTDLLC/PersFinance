FROM node:22-alpine AS base

WORKDIR /app

COPY package*.json ./


# ----------------------------
# Development
# Used by docker-compose-dev.yml
# ----------------------------
FROM base AS development

ENV NODE_ENV=development

RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]


# ----------------------------
# Build
# TypeScript/build tools are available here.
# ----------------------------
FROM base AS build

ENV NODE_ENV=development

RUN npm install

COPY . .

RUN npm run build


# ----------------------------
# Production
# Runtime-only image.
# ----------------------------
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./

RUN npm install --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/src/views ./src/views
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
