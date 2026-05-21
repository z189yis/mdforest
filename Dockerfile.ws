# Separate Dockerfile for the WebSocket server
FROM node:20-alpine AS base

# Install git (needed at runtime)
RUN apk add --no-cache git

WORKDIR /app

# Copy build artifacts from the main app build
# In production, run: docker compose build app && docker compose build ws
COPY package.json package-lock.json prisma/schema.prisma ./
COPY node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY next.config.ts ./

RUN npx prisma generate

EXPOSE 3001

CMD ["npx", "tsx", "src/server/ws/index.ts"]
