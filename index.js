const version = "0.0.3"

let allowedDomains = process?.env?.ALLOWED_REMOTE_DOMAINS?.split(",") || ["*"];
let imgproxyUrl = process?.env?.IMGPROXY_URL || "http://imgproxy:8080";
if (process.env.NODE_ENV === "development") {
    imgproxyUrl = "http://localhost:8888"
}

allowedDomains = allowedDomains.map(d => d.trim());

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

        if (url.pathname === "/_/health") {
            return new Response("ok");
        };

        if (url.pathname === "/_/info") {
            return new Response({
                name: "nextimg-server",
                version,
                description: "Next.js Image Transformation",
                author: "Sambo Chea",
            }, {
                headers: {
                    "Content-Type": "application/json",
                    "Server": "CUBIS OneCDN",
                }
            });
        };

        // Resize image
        if (url.pathname.startsWith("/image/")) return await resize(url);

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