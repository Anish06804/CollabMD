FROM node:20-alpine AS builder

WORKDIR /app

# Install all dependencies without running postinstall scripts
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy Prisma schema, TypeScript config, and source code
COPY prisma ./prisma
COPY tsconfig*.json ./
COPY src ./src

# Explicitly generate Prisma Client and build TypeScript code
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only without postinstall scripts
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy generated Prisma Client, build output, and schema from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 4000

CMD ["node", "dist/server.js"]
