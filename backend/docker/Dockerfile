FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and build

COPY prisma ./prisma
COPY src ./src
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package.json ./
RUN npm ci --omit=dev

# Copy built output
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

# Set up Prisma schema and binary
RUN npx prisma generate

# Expose port
EXPOSE 4000

# Start the server
CMD ["node", "dist/server.js"]