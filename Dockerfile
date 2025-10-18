# Use Bun base image
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source code and FFmpeg binaries
COPY src ./src
COPY bin ./bin
COPY tsconfig.json ./

# Make FFmpeg binaries executable
RUN chmod +x bin/ffmpeg bin/ffprobe

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/api/jobs -H "Authorization: Bearer ${JWT_SECRET}" || exit 1

# Run the application
CMD ["bun", "run", "src/index.ts"]

