# Open Media Transcoder

A high-performance video transcoding service that converts videos to HLS (HTTP Live Streaming) with multiple quality levels, thumbnails, and scrubbing previews.

## Features

- 🎬 **HLS Transcoding** - Adaptive bitrate streaming with 6 quality levels (360p to 4K)
- 🖼️ **Thumbnails** - Automatic poster and scrubbing thumbnails with WebVTT
- 🔐 **Secure** - JWT authentication and HMAC-signed webhooks
- ☁️ **S3-Compatible** - Works with any S3-compatible storage (AWS, MinIO, R2, etc.)
- 📊 **Progress Tracking** - Real-time progress updates during transcoding
- 🪝 **Webhooks** - Automatic notifications on job completion
- 🚀 **Fast** - Built with Bun and FFmpeg

## Quick Start

### Using Docker Compose

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Benjamoon/OpenMediaTranscoder.git
   cd OpenMediaTranscoder
   ```

2. **Create environment file:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start the service:**
   ```bash
   docker-compose up -d
   ```

4. **Get your auth token:**
   The authentication token is displayed in the logs on startup:
   ```bash
   docker-compose logs transcoder | grep -A 5 "Authentication Token"
   ```

### Using Docker

```bash
docker run -p 8080:8080 \
  -e S3_ENDPOINT=https://s3.example.com \
  -e S3_ACCESS_KEY_ID=your_key \
  -e S3_SECRET_ACCESS_KEY=your_secret \
  -e S3_RESULT_BUCKET_NAME=videos \
  -e JWT_SECRET=your_secret \
  ghcr.io/YOUR_USERNAME/openmediatranscoder:latest
```

## Usage

### 1. Get Authentication Token

The token is printed to the console when the server starts. To retrieve it:

**Docker Compose:**
```bash
docker-compose logs transcoder | grep -A 5 "Authentication Token"
```

**Docker:**
```bash
docker logs transcoder-container | grep -A 5 "Authentication Token"
```

**Local Development:**
Check the console output when you run `bun run src/index.ts`

**Set it as a variable:**
```bash
TOKEN="your_token_from_logs"
```

### 2. Create Transcoding Job

```bash
curl -X POST http://localhost:8080/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceUrl": "https://presigned-s3-url...",
    "webhookUrl": "https://your-app.com/webhooks/transcoding"
  }'
```

### 3. Check Job Status

```bash
curl http://localhost:8080/api/jobs/JOB_ID \
  -H "Authorization: Bearer $TOKEN"
```

## API Reference

### `POST /api/jobs`
Create a new transcoding job.

**Request:**
```json
{
  "sourceUrl": "string (presigned GET URL)",
  "resultKeyPrefix": "string (optional)",
  "webhookUrl": "string (optional)"
}
```

**Response:**
```json
{
  "id": "job-123",
  "status": "pending",
  "sourceUrl": "...",
  "resultKeyPrefix": "output/job-123/"
}
```

### `GET /api/jobs/:id`
Get job status and results.

**Response:**
```json
{
  "id": "job-123",
  "status": "done",
  "progress": {
    "step": "done",
    "percentage": 100,
    "message": "Transcoding complete!"
  },
  "posterUrl": "output/job-123/poster.jpg",
  "thumbnailsVtt": "output/job-123/thumbnails.vtt",
  "resultFiles": ["output/job-123/master.m3u8", ...]
}
```

### `GET /api/jobs`
List all jobs.

## Webhooks

Webhooks are sent when jobs complete or fail, signed with HMAC-SHA256.

**Headers:**
- `X-Webhook-Signature`: HMAC-SHA256 signature
- `X-Webhook-Timestamp`: ISO 8601 timestamp

**Payload:**
```json
{
  "event": "job.completed",
  "timestamp": "2025-10-18T12:34:56.789Z",
  "job": {
    "id": "job-123",
    "status": "done",
    "resultKeyPrefix": "output/job-123/",
    "posterUrl": "output/job-123/poster.jpg",
    "resultFiles": [...]
  }
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_ENDPOINT` | S3-compatible storage endpoint | Required |
| `S3_REGION` | Storage region | `us-east-1` |
| `S3_ACCESS_KEY_ID` | S3 access key | Required |
| `S3_SECRET_ACCESS_KEY` | S3 secret key | Required |
| `S3_RESULT_BUCKET_NAME` | Bucket for results | Required |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs | `false` |
| `JWT_SECRET` | JWT signing secret | Required |
| `WEBHOOK_SECRET` | Webhook signing secret | `JWT_SECRET` |

## Quality Levels

| Quality | Resolution | Video Bitrate | Audio Bitrate |
|---------|-----------|---------------|---------------|
| 360p | 640x360 | 800 kbps | 96 kbps |
| 480p | 854x480 | 1.4 Mbps | 128 kbps |
| 720p | 1280x720 | 2.8 Mbps | 128 kbps |
| 1080p | 1920x1080 | 5 Mbps | 192 kbps |
| 1440p | 2560x1440 | 9 Mbps | 192 kbps |
| 2160p | 3840x2160 | 16 Mbps | 256 kbps |

The transcoder automatically skips quality levels higher than the source resolution.

## Development

### Prerequisites
- [Bun](https://bun.sh) >= 1.0
- FFmpeg and FFprobe installed locally
  - macOS: `brew install ffmpeg`
  - Ubuntu: `sudo apt install ffmpeg`
  - Or place binaries in `bin/` directory

### Install Dependencies
```bash
bun install
```

### Run Locally
```bash
# If FFmpeg is in your PATH
bun run src/index.ts

# Or if using local bin/ directory
USE_SYSTEM_FFMPEG=false bun run src/index.ts
```

## License

MIT... Idk, do whatever you want! Took 5 minutes with a bit of help from Mr Claude.

Feel free to fix up the code quality a bit
