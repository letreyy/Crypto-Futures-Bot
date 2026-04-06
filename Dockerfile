FROM public.ecr.aws/docker/library/node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
# В Portainer может прокидываться NODE_ENV=production, из-за чего tsc не устанавливается. Жестко требуем dev-зависимости.
RUN npm install --include=dev

COPY . .
RUN npm run build

FROM public.ecr.aws/docker/library/node:20-slim

# Install system fonts so Sharp can render text on SVG charts (fixes the "square" characters issue)
RUN apt-get update && apt-get install -y --no-install-recommends \
    fontconfig \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
# Keep .env if needed, though usually passed via compose
# COPY .env .env

CMD ["npm", "run", "start"]
