FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY server.js ./
COPY lib ./lib
COPY public ./public

USER node
EXPOSE 8080

CMD ["node", "server.js"]
