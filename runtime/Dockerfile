FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build
RUN pnpm run build

# Ensure hub-dist exists (may be empty if not pre-built)
RUN mkdir -p hub-dist

# Production image
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built files and static assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/static ./static

# Copy hub frontend (pre-built, copied by deploy script)
COPY --from=builder /app/hub-dist ./hub-dist

# Set environment
ENV NODE_ENV=production

# Expose port
EXPOSE 8787

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8787/health || exit 1

# Run
CMD ["node", "dist/index.js"]
