FROM node:20-alpine AS builder

WORKDIR /app

# Alpine Linux par OpenSSL 3.0.x install karein
RUN apk add --no-cache openssl

# Dependencies install karein without postinstall scripts
COPY package*.json ./
RUN npm ci --ignore-scripts

# Code aur Prisma Schema copy karein
COPY prisma ./prisma
COPY tsconfig*.json ./
COPY src ./src

# Prisma Client generate aur TypeScript build karein
RUN npx prisma generate
RUN npm run build

# Production Stage
FROM node:20-alpine AS production

WORKDIR /app

# Production container me bhi OpenSSL install karein
RUN apk add --no-cache openssl

# Only production dependencies install karein
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Builder stage se output files copy karein
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 4000

CMD ["node", "dist/server.js"]
