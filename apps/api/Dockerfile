FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies (includes devDeps for building)
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace=apps/api --workspace=packages/shared

# Install production-only dependencies
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace=apps/api --workspace=packages/shared --omit=dev

# Build shared package
FROM base AS shared-builder
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared
COPY tsconfig.json ./
RUN npm run build --workspace=packages/shared

# Build API
FROM base AS api-builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist
COPY packages/shared/package.json ./packages/shared/
COPY apps/api ./apps/api
COPY tsconfig.json ./
RUN npm run build --workspace=apps/api

# Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs
COPY --from=api-builder /app/apps/api/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY apps/api/package.json ./
USER nestjs
EXPOSE 4000
CMD ["node", "dist/main"]
