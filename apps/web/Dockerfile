FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci

# Build shared package
FROM base AS shared-builder
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY packages/shared ./packages/shared
COPY tsconfig.json ./
RUN npm run build --workspace=packages/shared

# Build Next.js app
FROM base AS web-builder
COPY package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist
COPY packages/shared/src ./packages/shared/src
COPY apps/web ./apps/web
COPY tsconfig.json ./
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=apps/web

# Production image
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=web-builder /app/apps/web/.next/standalone ./
COPY --from=web-builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-builder /app/apps/web/public ./apps/web/public
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./node_modules
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist
COPY packages/shared/package.json ./packages/shared/
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
