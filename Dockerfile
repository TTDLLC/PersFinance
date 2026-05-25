FROM node:22-alpine AS base

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

RUN npm run build

RUN cp -R src/views dist/src/views && \
    cp -R src/public dist/src/public

EXPOSE 3000

CMD ["node", "dist/src/server.js"]