// src/transcoder.ts
import { spawn } from "bun";
import { mkdir, readdir, readFile, rm } from "fs/promises";
import { join } from "path";

export interface QualityLevel {
    name: string;
    height: number;
    videoBitrate: string;
    audioBitrate: string;
}

export interface TranscodeOptions {
    outputPrefix: string;  // e.g., "output/job-123/"
    segmentDuration?: number;  // seconds per segment, default 10
    qualities?: QualityLevel[];  // Custom quality levels, or use defaults
    generateThumbnails?: boolean;  // Generate poster + scrubbing thumbnails, default true
    thumbnailInterval?: number;  // Seconds between scrubbing thumbnails, default 10
    onProgress?: (currentQuality: string, completedQualities: string[], totalQualities: number) => void;
}

// Default quality levels for adaptive bitrate streaming
const DEFAULT_QUALITIES: QualityLevel[] = [
    { name: "360p", height: 360, videoBitrate: "800k", audioBitrate: "96k" },
    { name: "480p", height: 480, videoBitrate: "1400k", audioBitrate: "128k" },
    { name: "720p", height: 720, videoBitrate: "2800k", audioBitrate: "128k" },
    { name: "1080p", height: 1080, videoBitrate: "5000k", audioBitrate: "192k" },
    { name: "1440p", height: 1440, videoBitrate: "9000k", audioBitrate: "192k" },
    { name: "2160p", height: 2160, videoBitrate: "16000k", audioBitrate: "256k" },
];

export interface TranscodedFile {
    key: string;
    data: Buffer;
    contentType: string;
}

/**
 * Get video resolution using ffprobe
 */
async function getVideoResolution(inputFile: string): Promise<{ width: number; height: number }> {
    const ffprobePath = join(process.cwd(), "bin", "ffprobe");

    const proc = spawn({
        cmd: [
            ffprobePath,
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            inputFile
        ],
        stdout: "pipe",
        stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        throw new Error("Failed to probe video resolution");
    }

    const data = JSON.parse(output);
    const stream = data.streams?.[0];

    if (!stream?.width || !stream?.height) {
        throw new Error("Could not determine video resolution");
    }

    return { width: stream.width, height: stream.height };
}

/**
 * Transcode video to HLS format with multiple quality levels
 */
export async function transcodeToHLS(
    sourceData: ArrayBuffer,
    options: TranscodeOptions
): Promise<TranscodedFile[]> {
    const workDir = `/tmp/transcode-${crypto.randomUUID()}`;
    const inputFile = join(workDir, "input.mp4");
    const ffmpegPath = join(process.cwd(), "bin", "ffmpeg");
    const qualities = options.qualities ?? DEFAULT_QUALITIES;

    try {
        // Create work directory
        await mkdir(workDir, { recursive: true });

        // Write source data to temp file
        await Bun.write(inputFile, sourceData);

        // Detect input resolution
        const inputResolution = await getVideoResolution(inputFile);
        console.log(`  Input resolution: ${inputResolution.width}x${inputResolution.height}`);

        // Filter qualities to only those <= input resolution
        const validQualities = qualities.filter(q => q.height <= inputResolution.height);

        if (validQualities.length === 0) {
            // Input is very low res, just use the lowest quality setting
            validQualities.push(qualities[0]);
        }

        console.log(`  Transcoding ${validQualities.length} quality levels: ${validQualities.map(q => q.name).join(", ")}`);

        const transcodedFiles: TranscodedFile[] = [];
        const completedQualities: string[] = [];

        // Transcode each quality level
        for (const quality of validQualities) {
            console.log(`  Transcoding ${quality.name}...`);

            // Report progress
            if (options.onProgress) {
                options.onProgress(quality.name, completedQualities, validQualities.length);
            }

            const qualityDir = join(workDir, quality.name);
            await mkdir(qualityDir, { recursive: true });

            const outputPattern = join(qualityDir, "segment-%03d.ts");
            const playlistFile = join(qualityDir, "playlist.m3u8");

            // Build FFmpeg command for this quality
            const ffmpegArgs = [
                "-i", inputFile,
                "-c:v", "libx264",
                "-c:a", "aac",
                "-vf", `scale=-2:${quality.height}`,  // Scale to target height, maintain aspect ratio
                "-b:v", quality.videoBitrate,
                "-b:a", quality.audioBitrate,
                "-preset", "medium",  // Encoding speed/quality tradeoff
                "-profile:v", "main",
                "-level", "4.0",
                "-f", "hls",
                "-hls_time", String(options.segmentDuration ?? 10),
                "-hls_list_size", "0",
                "-hls_segment_filename", outputPattern,
                playlistFile
            ];

            // Run FFmpeg
            const proc = spawn({
                cmd: [ffmpegPath, ...ffmpegArgs],
                stdout: "pipe",
                stderr: "pipe",
            });

            const exitCode = await proc.exited;

            if (exitCode !== 0) {
                const stderr = await new Response(proc.stderr).text();
                throw new Error(`FFmpeg failed for ${quality.name} with exit code ${exitCode}: ${stderr}`);
            }

            // Read output files for this quality
            const files = await readdir(qualityDir);

            for (const file of files) {
                const filePath = join(qualityDir, file);
                const data = await readFile(filePath);

                let contentType: string;
                if (file.endsWith(".m3u8")) {
                    contentType = "application/x-mpegURL";
                } else if (file.endsWith(".ts")) {
                    contentType = "video/MP2T";
                } else {
                    contentType = "application/octet-stream";
                }

                transcodedFiles.push({
                    key: `${options.outputPrefix}${quality.name}/${file}`,
                    data: Buffer.from(data),
                    contentType,
                });
            }

            // Mark quality as completed
            completedQualities.push(quality.name);
        }

        // Create master playlist
        const masterPlaylist = generateMasterPlaylist(validQualities, options.outputPrefix);
        transcodedFiles.push({
            key: `${options.outputPrefix}master.m3u8`,
            data: Buffer.from(masterPlaylist),
            contentType: "application/x-mpegURL",
        });

        // Generate thumbnails if requested
        if (options.generateThumbnails !== false) {
            console.log("  Generating thumbnails...");

            // Report thumbnail generation progress
            if (options.onProgress) {
                options.onProgress("thumbnails", completedQualities, validQualities.length);
            }

            const thumbnails = await generateThumbnails(inputFile, workDir, ffmpegPath, options);
            transcodedFiles.push(...thumbnails.map(t => ({
                key: `${options.outputPrefix}${t.filename}`,
                data: t.data,
                contentType: t.contentType,
            })));
        }

        return transcodedFiles;
    } finally {
        // Cleanup temp directory
        try {
            await rm(workDir, { recursive: true, force: true });
        } catch (err) {
            console.error("Failed to cleanup temp directory:", err);
        }
    }
}

/**
 * Generate HLS master playlist
 */
function generateMasterPlaylist(qualities: QualityLevel[], prefix: string): string {
    let playlist = "#EXTM3U\n#EXT-X-VERSION:3\n\n";

    for (const quality of qualities) {
        // Parse bitrate from string (e.g., "800k" -> 800000, "2M" -> 2000000)
        const videoBitrateNum = parseBitrate(quality.videoBitrate);
        const audioBitrateNum = parseBitrate(quality.audioBitrate);
        const totalBitrate = videoBitrateNum + audioBitrateNum;

        playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${totalBitrate},RESOLUTION=${Math.floor(quality.height * 16 / 9)}x${quality.height},NAME="${quality.name}"\n`;
        playlist += `${quality.name}/playlist.m3u8\n\n`;
    }

    return playlist;
}

/**
 * Parse bitrate string to number in bits per second
 */
function parseBitrate(bitrate: string): number {
    const match = bitrate.match(/^(\d+(?:\.\d+)?)(k|M)?$/i);
    if (!match) return 0;

    const value = parseFloat(match[1]);
    const unit = match[2]?.toLowerCase();

    if (unit === 'k') return Math.floor(value * 1000);
    if (unit === 'm') return Math.floor(value * 1000000);
    return Math.floor(value);
}

/**
 * Get video duration in seconds
 */
async function getVideoDuration(inputFile: string): Promise<number> {
    const ffprobePath = join(process.cwd(), "bin", "ffprobe");

    const proc = spawn({
        cmd: [
            ffprobePath,
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            inputFile
        ],
        stdout: "pipe",
        stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
        throw new Error("Failed to get video duration");
    }

    const data = JSON.parse(output);
    const duration = parseFloat(data.format?.duration);

    if (!duration || isNaN(duration)) {
        throw new Error("Could not determine video duration");
    }

    return duration;
}

interface ThumbnailFile {
    filename: string;
    data: Buffer;
    contentType: string;
}

/**
 * Generate poster thumbnail and scrubbing thumbnails
 */
async function generateThumbnails(
    inputFile: string,
    workDir: string,
    ffmpegPath: string,
    options: TranscodeOptions
): Promise<ThumbnailFile[]> {
    const thumbnails: ThumbnailFile[] = [];
    const thumbDir = join(workDir, "thumbnails");
    await mkdir(thumbDir, { recursive: true });

    const duration = await getVideoDuration(inputFile);

    // Generate poster thumbnail at 10% into the video (or 1 second, whichever is later)
    const posterTime = Math.max(1, duration * 0.1);
    const posterFile = join(thumbDir, "poster.jpg");

    console.log("    Generating poster thumbnail...");
    let proc = spawn({
        cmd: [
            ffmpegPath,
            "-ss", posterTime.toString(),
            "-i", inputFile,
            "-vframes", "1",
            "-vf", "scale=1280:-2",  // 1280px wide, maintain aspect ratio
            "-q:v", "2",  // High quality JPEG
            posterFile
        ],
        stdout: "pipe",
        stderr: "pipe",
    });

    let exitCode = await proc.exited;
    if (exitCode !== 0) {
        console.warn("Failed to generate poster thumbnail");
    } else {
        const posterData = await readFile(posterFile);
        thumbnails.push({
            filename: "poster.jpg",
            data: Buffer.from(posterData),
            contentType: "image/jpeg",
        });
    }

    // Generate scrubbing thumbnails
    const interval = options.thumbnailInterval ?? 10;
    const thumbCount = Math.floor(duration / interval);

    if (thumbCount > 0) {
        console.log(`    Generating ${thumbCount} scrubbing thumbnails...`);

        // Generate individual thumbnails
        const thumbnailPattern = join(thumbDir, "thumb-%03d.jpg");

        proc = spawn({
            cmd: [
                ffmpegPath,
                "-i", inputFile,
                "-vf", `fps=1/${interval},scale=160:-2`,  // 160px wide thumbnails
                "-q:v", "5",  // Moderate quality for smaller size
                thumbnailPattern
            ],
            stdout: "pipe",
            stderr: "pipe",
        });

        exitCode = await proc.exited;
        if (exitCode !== 0) {
            console.warn("Failed to generate scrubbing thumbnails");
        } else {
            // Create sprite sheet from individual thumbnails
            const thumbFiles = (await readdir(thumbDir))
                .filter(f => f.startsWith("thumb-") && f.endsWith(".jpg"))
                .sort();

            if (thumbFiles.length > 0) {
                // Calculate sprite sheet dimensions (10 columns)
                const cols = 10;
                const rows = Math.ceil(thumbFiles.length / cols);
                const spriteFile = join(thumbDir, "sprites.jpg");

                // Create sprite sheet using FFmpeg tile filter
                const tileInputs: string[] = [];
                for (const file of thumbFiles) {
                    tileInputs.push("-i", join(thumbDir, file));
                }

                proc = spawn({
                    cmd: [
                        ffmpegPath,
                        ...tileInputs,
                        "-filter_complex", `tile=${cols}x${rows}`,
                        "-q:v", "5",
                        spriteFile
                    ],
                    stdout: "pipe",
                    stderr: "pipe",
                });

                exitCode = await proc.exited;
                if (exitCode === 0) {
                    const spriteData = await readFile(spriteFile);
                    thumbnails.push({
                        filename: "sprites.jpg",
                        data: Buffer.from(spriteData),
                        contentType: "image/jpeg",
                    });

                    // Generate WebVTT file for scrubbing thumbnails
                    const vttContent = generateThumbnailVTT(thumbFiles.length, interval, cols);
                    thumbnails.push({
                        filename: "thumbnails.vtt",
                        data: Buffer.from(vttContent),
                        contentType: "text/vtt",
                    });
                }
            }
        }
    }

    return thumbnails;
}

/**
 * Generate WebVTT file for thumbnail sprites
 */
function generateThumbnailVTT(count: number, interval: number, cols: number): string {
    let vtt = "WEBVTT\n\n";

    const thumbWidth = 160;
    const thumbHeight = 90;  // Assuming 16:9 aspect ratio

    for (let i = 0; i < count; i++) {
        const startTime = i * interval;
        const endTime = (i + 1) * interval;

        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * thumbWidth;
        const y = row * thumbHeight;

        vtt += formatVTTTime(startTime) + " --> " + formatVTTTime(endTime) + "\n";
        vtt += `sprites.jpg#xywh=${x},${y},${thumbWidth},${thumbHeight}\n\n`;
    }

    return vtt;
}

/**
 * Format seconds to WebVTT timestamp (HH:MM:SS.mmm)
 */
function formatVTTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

