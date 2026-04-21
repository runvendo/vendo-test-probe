FROM node:20-alpine

WORKDIR /app

COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node

EXPOSE 8080

CMD ["node", "src/server.js"]
