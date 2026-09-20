FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci

COPY client ./client
COPY server ./server
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app

COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/server ./server
COPY --chown=node:node --from=build /app/client/dist ./client/dist
RUN chmod -R u=rwX,go=rX /app/server /app/client /app/node_modules /app/package.json

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
