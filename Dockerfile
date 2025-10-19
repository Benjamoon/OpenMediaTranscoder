# Stage 1: Get static FFmpeg binaries
FROM mwader/static-ffmpeg:7.1 AS ffmpeg

# Stage 2: Build final image with Bun
FROM oven/bun:1-slim
WORKDIR /app

# Copy FFmpeg binaries from ffmpeg stage
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe

# Install curl for health checks
RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source code
COPY src ./src
COPY tsconfig.json ./

# Set environment to use system FFmpeg
ENV USE_SYSTEM_FFMPEG=true

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/jobs || exit 1

# Run the application
CMD ["bun", "run", "src/index.ts"]

