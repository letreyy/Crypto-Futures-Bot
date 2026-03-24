FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
# В Portainer может прокидываться NODE_ENV=production, из-за чего tsc не устанавливается. Жестко требуем dev-зависимости.
RUN npm install --include=dev

COPY . .
RUN npm run build

FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
# Keep .env if needed, though usually passed via compose
# COPY .env .env

CMD ["npm", "run", "start"]
