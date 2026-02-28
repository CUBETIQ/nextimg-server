// Load the version from package.json
import { readFileSync, unlinkSync, mkdirSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
const packageJsonPath = join(import.meta.dirname, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const version = packageJson.version || "dev";

let allowedDomains = process?.env?.ALLOWED_REMOTE_DOMAINS?.split(",") || ["*"];
let imgproxyUrl = process?.env?.IMGPROXY_URL || "http://imgproxy:8080";
let internalUrl = process?.env?.INTERNAL_URL || "http://host.docker.internal:3000";
if (process.env.NODE_ENV === "development") {
    imgproxyUrl = "http://localhost:8888";
    internalUrl = "http://localhost:3000";
}

allowedDomains = allowedDomains.map(d => d.trim());

// Compressed output TTL in seconds (default 1 hour, 0 = keep forever)
const outputTTL = parseInt(process?.env?.OUTPUT_TTL || "3600", 10);

// Single data store directory for both temp uploads and compressed outputs
const dataStorePath = process?.env?.DATA_STORE_PATH || join(import.meta.dirname, "store");
const dataDir = dataStorePath.startsWith("/") ? dataStorePath : join(import.meta.dirname, dataStorePath);
try { mkdirSync(dataDir, { recursive: true }); } catch {}

Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/") {
            return new Response("CUBIS OneCDN - Next Image Transformation", {
                headers: {
                    "Content-Type": "text/plain",
                    "Server": "CUBIS OneCDN",
                }
            });
        }

        if (url.pathname === "/_/ui" || url.pathname === "/demo") {
            if (url.pathname === "/demo") {
                return new Response(null, { status: 301, headers: { Location: "/_/ui" } });
            }
            const html = readFileSync(join(import.meta.dirname, "public", "demo.html"), "utf-8");
            return new Response(html, {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Server": "CUBIS OneCDN",
                }
            });
        }

        if (url.pathname === "/_/ui/examples") {
            const html = readFileSync(join(import.meta.dirname, "public", "examples.html"), "utf-8");
            return new Response(html, {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Server": "CUBIS OneCDN",
                }
            });
        }

        if (url.pathname === "/_/health") {
            return new Response("ok");
        };

        if (url.pathname === "/_/info") {
            return new Response(JSON.stringify({
                name: "nextimg-server",
                version,
                description: "Next.js Image Transformation",
                author: "Sambo Chea",
            }), {
                headers: {
                    "Content-Type": "application/json",
                    "Server": "CUBIS OneCDN",
                }
            });
        };

        // Serve stored files (temp uploads + compressed outputs)
        if (url.pathname.startsWith("/_/store/")) return await serveStore(url);

        // Resize image
        if (url.pathname.startsWith("/image/")) return await resize(url);

        // Compress and optimize image (URL-based)
        if (url.pathname.startsWith("/compress/")) return await compress(url);

        // Upload, compress and return optimized image (binary) or JSON stats (Accept: application/json)
        if (req.method === "POST" && url.pathname === "/upload/compress") return await uploadCompress(req, url);

        return new Response("nothing...", {
            status: 404,
            headers: {
                "Content-Type": "text/plain",
            },
        });
    }
});

async function resize(url) {
    const preset = "pr:sharp"
    const src = url.pathname.split("/").slice(2).join("/");
    const origin = new URL(src).hostname;
    const allowed = allowedDomains.filter(domain => {
        if (domain === "*") return true;
        if (domain === origin) return true;
        if (domain.startsWith("*.") && origin.endsWith(domain.split("*.").pop())) return true;
        return false;
    })

    if (allowed.length === 0) {
        return new Response(`Domain (${origin}) not allowed.`, { status: 403 });
    }

    const width = url.searchParams.get("width") || 0;
    const height = url.searchParams.get("height") || 0;
    const quality = url.searchParams.get("quality") || 75;

    try {
        const url = `${imgproxyUrl}/${preset}/resize:fill:${width}:${height}/q:${quality}/plain/${src}`
        const image = await fetch(url, {
            headers: {
                "Accept": "image/avif,image/webp,image/apng,*/*",
            }
        })
        const headers = new Headers(image.headers);
        // Add CORS headers
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        headers.set("Server", "CUBIS OneCDN");
        return new Response(image.body, {
            headers
        })
    } catch (e) {
        console.log(e)
        return new Response("Error resizing image")
    }
}

async function serveStore(url) {
    const filename = url.pathname.split("/").pop();
    if (!filename || filename.includes("..")) {
        return new Response("Not found", { status: 404 });
    }
    const filePath = join(dataDir, filename);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
        return new Response("Not found", { status: 404 });
    }
    return new Response(file);
}

function cleanupDataDir() {
    if (outputTTL <= 0) return; // 0 = keep forever
    try {
        const now = Date.now();
        for (const f of readdirSync(dataDir)) {
            // Only clean up compressed output files (out- prefix), never temp uploads
            if (!f.startsWith("out-")) continue;
            try {
                const fp = join(dataDir, f);
                const mtime = statSync(fp).mtimeMs;
                if (now - mtime > outputTTL * 1000) {
                    unlinkSync(fp);
                }
            } catch {}
        }
    } catch {}
}

async function uploadCompress(req, url) {
    const preset = "pr:sharp";
    const quality = url.searchParams.get("quality") || 80;
    const format = url.searchParams.get("format") || ""; // e.g. webp, avif, jpeg, png
    const acceptJson = (req.headers.get("accept") || "").includes("application/json");

    // Lazy cleanup of expired compressed output files (only needed for JSON/stats mode)
    if (acceptJson) cleanupDataDir();

    let contentType;
    let buffer;
    let originalFilename = "upload";

    try {
        contentType = req.headers.get("content-type") || "";
        if (contentType.startsWith("multipart/form-data")) {
            const form = await req.formData();
            const file = form.get("file") || form.get("image");
            if (!file || typeof file === "string") {
                return new Response("Missing file field (use 'file' or 'image')", { status: 400 });
            }
            buffer = await file.arrayBuffer();
            contentType = file.type || "application/octet-stream";
            originalFilename = file.name || originalFilename;
        } else {
            // Raw binary body (Content-Type: image/*)
            buffer = await req.arrayBuffer();
            const xFilename = req.headers.get("x-filename");
            if (xFilename) originalFilename = xFilename;
        }
    } catch (e) {
        console.log(e);
        return new Response("Failed to read uploaded file", { status: 400 });
    }

    const extMap = {
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
        "image/avif": "avif", "image/gif": "gif", "image/tiff": "tiff",
    };
    const srcExt = extMap[contentType] || "bin";
    const outExt = format ? (format === "jpeg" ? "jpg" : format) : srcExt;
    const uuid = randomUUID();
    const tmpFilename = `tmp-${uuid}.${srcExt}`;
    const tmpFilePath = join(dataDir, tmpFilename);
    // Output file is only persisted in JSON/stats mode
    const outFilename = `out-${uuid}.${outExt}`;
    const outFilePath = join(dataDir, outFilename);
    const originalSize = buffer.byteLength;

    try {
        await Bun.write(tmpFilePath, buffer);

        const formatOption = format ? `/format:${format}` : "";
        const srcUrl = `${internalUrl}/_/store/${tmpFilename}`;
        const imgUrl = `${imgproxyUrl}/${preset}/q:${quality}/strip_metadata:1${formatOption}/plain/${srcUrl}`;

        const image = await fetch(imgUrl, {
            headers: { "Accept": "image/avif,image/webp,image/apng,*/*" }
        });

        const resultBuffer = await image.arrayBuffer();
        const optimizedContentType = image.headers.get("content-type") || `image/${outExt}`;

        if (acceptJson) {
            // Persist output file and return stats
            await Bun.write(outFilePath, resultBuffer);

            const optimizedSize = resultBuffer.byteLength;
            const savedSize = originalSize - optimizedSize;
            const savedPercent = originalSize > 0
                ? Math.round((savedSize / originalSize) * 10000) / 100
                : 0;
            const ttlSeconds = outputTTL > 0 ? outputTTL : null;
            const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
            const downloadUrl = `${internalUrl}/_/store/${outFilename}`;

            const stats = {
                success: true,
                originalFilename,
                filename: outFilename,
                format: format || srcExt,
                quality: Number(quality),
                originalSize,
                optimizedSize,
                savedSize,
                savedPercent,
                downloadUrl,
                contentType: optimizedContentType,
                ttl: ttlSeconds,
                expiresAt,
            };

            return new Response(JSON.stringify(stats, null, 2), {
                headers: {
                    "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Server": "CUBIS OneCDN",
                }
            });
        } else {
            // Return raw optimized image binary
            const headers = new Headers(image.headers);
            headers.set("Access-Control-Allow-Origin", "*");
            headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
            headers.set("Server", "CUBIS OneCDN");
            return new Response(resultBuffer, { headers });
        }
    } catch (e) {
        console.log(e);
        const errBody = acceptJson
            ? JSON.stringify({ success: false, error: "Error compressing uploaded image" })
            : "Error compressing uploaded image";
        return new Response(errBody, {
            status: 500,
            headers: { "Content-Type": acceptJson ? "application/json" : "text/plain" },
        });
    } finally {
        try { unlinkSync(tmpFilePath); } catch {}
    }
}

async function compress(url) {
    const preset = "pr:sharp"
    const src = url.pathname.split("/").slice(2).join("/");
    const origin = new URL(src).hostname;
    const allowed = allowedDomains.filter(domain => {
        if (domain === "*") return true;
        if (domain === origin) return true;
        if (domain.startsWith("*.") && origin.endsWith(domain.split("*.").pop())) return true;
        return false;
    });

    if (allowed.length === 0) {
        return new Response(`Domain (${origin}) not allowed.`, { status: 403 });
    }

    const quality = url.searchParams.get("quality") || 80;
    const format = url.searchParams.get("format") || ""; // e.g. webp, avif, jpeg, png

    try {
        const formatOption = format ? `/format:${format}` : "";
        const imgUrl = `${imgproxyUrl}/${preset}/q:${quality}/strip_metadata:1${formatOption}/plain/${src}`;
        const image = await fetch(imgUrl, {
            headers: {
                "Accept": "image/avif,image/webp,image/apng,*/*",
            }
        });
        const headers = new Headers(image.headers);
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        headers.set("Server", "CUBIS OneCDN");
        return new Response(image.body, { headers });
    } catch (e) {
        console.log(e);
        return new Response("Error compressing image", { status: 500 });
    }
}