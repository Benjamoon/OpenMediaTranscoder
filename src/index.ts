// src/index.ts
import { Hono } from "hono";
import { createJob, getJob, listJobs, updateJob } from "./jobs";
import { issueToken, verifyToken } from "./auth";
import { uploadMultipleResults } from "./s3";
import { transcodeToHLS } from "./transcoder";

const app = new Hono();

// --- Generate and display token on startup ---
const startupToken = await issueToken({ user: "admin", service: "transcoder" });
console.log("\n" + "=".repeat(80));
console.log("🔐 OpenMediaTranscoder - Authentication Token");
console.log("=".repeat(80));
console.log("\nYour authentication token:");
console.log("\n  " + startupToken);
console.log("\nUse this in API requests:");
console.log('  Authorization: Bearer ' + startupToken);
console.log("\n" + "=".repeat(80) + "\n");

// --- Helper: Generate webhook signature ---
async function generateWebhookSignature(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );

    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(payload)
    );

    // Convert to hex string
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// --- Helper: Send webhook notification ---
async function sendWebhook(webhookUrl: string, job: any) {
    try {
        console.log(`[Webhook] Sending notification to ${webhookUrl}...`);

        const payload = {
            event: job.status === "done" ? "job.completed" : "job.failed",
            timestamp: new Date().toISOString(),
            job: {
                id: job.id,
                status: job.status,
                resultKeyPrefix: job.resultKeyPrefix,
                posterUrl: job.posterUrl,
                thumbnailsVtt: job.thumbnailsVtt,
                resultFiles: job.resultFiles,
                error: job.error,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            }
        };

        const body = JSON.stringify(payload);

        // Generate HMAC signature for verification
        const webhookSecret = process.env.WEBHOOK_SECRET ?? process.env.JWT_SECRET ?? "";
        const signature = await generateWebhookSignature(body, webhookSecret);

        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "OpenMediaTranscoder/1.0",
                "X-Webhook-Signature": signature,
                "X-Webhook-Timestamp": payload.timestamp,
            },
            body,
        });

        if (!response.ok) {
            console.warn(`[Webhook] Failed with status ${response.status}`);
        } else {
            console.log(`[Webhook] Notification sent successfully`);
        }
    } catch (error) {
        console.error(`[Webhook] Error sending notification:`, error);
        // Don't throw - webhook failures shouldn't affect the job
    }
}

// --- JWT Auth middleware ---
app.use("/api/*", async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.substring(7); // Remove "Bearer " prefix

    try {
        await verifyToken(token);
        await next();
    } catch (err) {
        return c.json({ error: "Invalid token" }, 401);
    }
});

// --- Create a new transcode job ---
app.post("/api/jobs", async (c) => {
    const body = await c.req.json<{
        sourceUrl: string;         // Presigned GET URL for source file
        resultKeyPrefix?: string;  // Optional: S3 key prefix (defaults to "output/{jobId}/")
        webhookUrl?: string;       // Optional: Webhook URL to notify on completion
    }>();

    // Default result key prefix to "output/{jobId}/"
    const resultKeyPrefix = body.resultKeyPrefix ?? `output/${crypto.randomUUID()}/`;
    const job = createJob(body.sourceUrl, resultKeyPrefix, body.webhookUrl);

    // Process transcoding asynchronously
    (async () => {
        try {
            // Download source file from presigned GET URL
            updateJob(job.id, {
                status: "processing",
                progress: {
                    step: "downloading",
                    percentage: 0,
                    message: "Downloading source video..."
                }
            });
            console.log(`[Job ${job.id}] Downloading source from presigned URL...`);

            const sourceResponse = await fetch(job.sourceUrl);
            if (!sourceResponse.ok) {
                throw new Error(`Failed to download source: ${sourceResponse.statusText}`);
            }
            const sourceData = await sourceResponse.arrayBuffer();
            console.log(`[Job ${job.id}] Downloaded ${sourceData.byteLength} bytes`);

            // Transcode to HLS with multiple quality levels
            console.log(`[Job ${job.id}] Starting transcoding (up to 6 quality levels: 360p-2160p)...`);

            // Progress callback for transcoding
            const onProgress = (current: string, completed: string[], total: number) => {
                const percentage = Math.round((completed.length / total) * 60) + 10; // 10-70%
                updateJob(job.id, {
                    progress: {
                        step: "transcoding",
                        currentQuality: current,
                        completedQualities: completed,
                        totalQualities: total,
                        percentage,
                        message: `Transcoding ${current} (${completed.length}/${total} complete)...`
                    }
                });
            };

            const files = await transcodeToHLS(sourceData, {
                outputPrefix: job.resultKeyPrefix,
                segmentDuration: 10,
                onProgress,
            });
            console.log(`[Job ${job.id}] Transcoded to ${files.length} files`);

            // Upload all files to S3
            updateJob(job.id, {
                progress: {
                    step: "uploading",
                    percentage: 80,
                    message: `Uploading ${files.length} files to S3...`
                }
            });
            console.log(`[Job ${job.id}] Uploading to S3...`);
            await uploadMultipleResults(files);
            console.log(`[Job ${job.id}] Upload complete`);

            // Find poster and thumbnails
            const posterKey = files.find(f => f.key.endsWith("poster.jpg"))?.key;
            const thumbnailsVttKey = files.find(f => f.key.endsWith("thumbnails.vtt"))?.key;

            updateJob(job.id, {
                status: "done",
                progress: {
                    step: "done",
                    percentage: 100,
                    message: "Transcoding complete!"
                },
                resultFiles: files.map(f => f.key),
                posterUrl: posterKey,
                thumbnailsVtt: thumbnailsVttKey,
            });

            // Send webhook notification if provided
            if (job.webhookUrl) {
                await sendWebhook(job.webhookUrl, getJob(job.id)!);
            }
        } catch (error) {
            console.error(`[Job ${job.id}] Error:`, error);
            updateJob(job.id, {
                status: "error",
                error: error instanceof Error ? error.message : "Unknown error"
            });

            // Send webhook notification even on error
            if (job.webhookUrl) {
                await sendWebhook(job.webhookUrl, getJob(job.id)!);
            }
        }
    })();

    return c.json(job);
});

// --- Get all jobs ---
app.get("/api/jobs", (c) => c.json(listJobs()));

// --- Get single job ---
app.get("/api/jobs/:id", (c) => {
    const job = getJob(c.req.param("id"));
    if (!job) return c.notFound();
    return c.json(job);
});


export default {
    port: 8080,
    fetch: app.fetch,
};