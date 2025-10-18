// src/jobs.ts
export type JobStatus = "pending" | "processing" | "done" | "error";

export interface JobProgress {
    step: string;              // Current step: "downloading", "transcoding", "thumbnails", "uploading"
    currentQuality?: string;   // Current quality being transcoded (e.g., "720p")
    completedQualities?: string[];  // Completed quality levels
    totalQualities?: number;   // Total number of qualities to transcode
    percentage?: number;       // Overall progress (0-100)
    message?: string;          // Human-readable status message
}

export interface Job {
    id: string;
    sourceUrl: string;          // Presigned GET URL for source file
    resultKeyPrefix: string;    // S3 key prefix where results will be uploaded
    webhookUrl?: string;        // Optional webhook URL to notify when job completes
    status: JobStatus;
    progress?: JobProgress;     // Detailed progress information
    createdAt: number;
    updatedAt: number;
    resultFiles?: string[];     // Array of S3 keys for all uploaded result files
    posterUrl?: string;         // S3 key for poster thumbnail
    thumbnailsVtt?: string;     // S3 key for WebVTT thumbnails file
    error?: string;
}

const jobs = new Map<string, Job>();

export function createJob(sourceUrl: string, resultKeyPrefix: string, webhookUrl?: string): Job {
    const id = crypto.randomUUID();
    const now = Date.now();
    const job: Job = {
        id,
        sourceUrl,
        resultKeyPrefix,
        webhookUrl,
        status: "pending",
        createdAt: now,
        updatedAt: now,
    };
    jobs.set(id, job);
    return job;
}

export function updateJob(id: string, updates: Partial<Job>) {
    const job = jobs.get(id);
    if (!job) return;
    Object.assign(job, updates, { updatedAt: Date.now() });
}

export function getJob(id: string) {
    return jobs.get(id);
}

export function listJobs() {
    return Array.from(jobs.values());
}