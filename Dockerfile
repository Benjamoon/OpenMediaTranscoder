# Use Bun base image
FROM oven/bun:1 AS base
WORKDIR /app

# Install FFmpeg and other dependencies
RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Expose port
EXPOSE 8080

# Set environment to use system FFmpeg
ENV USE_SYSTEM_FFMPEG=true

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/jobs || exit 1

# Run the application
CMD ["bun", "run", "src/index.ts"]

