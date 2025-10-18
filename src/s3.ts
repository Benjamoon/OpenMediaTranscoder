// src/s3.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3Client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT,  // Custom endpoint for S3-compatible storage
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",  // Required for some S3-compatible storage
});

const RESULT_BUCKET = process.env.S3_RESULT_BUCKET_NAME!;

/**
 * Upload a file to the result S3 bucket
 */
export async function uploadResult(key: string, data: Buffer | Uint8Array, contentType: string) {
    const command = new PutObjectCommand({
        Bucket: RESULT_BUCKET,
        Key: key,
        Body: data,
        ContentType: contentType,
    });

    await s3Client.send(command);
}

/**
 * Upload multiple files (useful for HLS playlists with segments)
 */
export async function uploadMultipleResults(
    files: Array<{ key: string; data: Buffer | Uint8Array; contentType: string }>
) {
    await Promise.all(
        files.map(file => uploadResult(file.key, file.data, file.contentType))
    );
}

