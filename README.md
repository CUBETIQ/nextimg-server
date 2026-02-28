# NextImg Server

A lightweight image transformation proxy powered by [imgproxy](https://imgproxy.net), built with [Bun](https://bun.sh).

**Features**

- [x] Resize image (remote URL)
- [x] Compress & optimize image (remote URL)
- [x] Upload, compress & return optimized image — binary or JSON stats via `Accept` header

---

## Endpoints

### `GET /`

Health probe / banner.

```
GET http://localhost:3000/
```

---

### `GET /_/health`

Returns `ok` when the server is running.

```
GET http://localhost:3000/_/health
```

---

### `GET /_/info`

Returns server metadata as JSON.

```
GET http://localhost:3000/_/info
```

```json
{
    "name": "nextimg-server",
    "version": "0.0.5",
    "description": "Next.js Image Transformation",
    "author": "Sambo Chea"
}
```

---

### `GET /image/<image-url>`

Resize a remote image.

| Query param | Default | Description                          |
| ----------- | ------- | ------------------------------------ |
| `width`     | `0`     | Target width in pixels (`0` = auto)  |
| `height`    | `0`     | Target height in pixels (`0` = auto) |
| `quality`   | `75`    | Output quality (1–100)               |

**Example**

```
GET http://localhost:3000/image/https://example.com/photo.jpg?width=800&height=600&quality=80
```

---

### `GET /compress/<image-url>`

Compress and optimize a remote image without resizing. Strips metadata (EXIF, etc.).

| Query param | Default            | Description                                 |
| ----------- | ------------------ | ------------------------------------------- |
| `quality`   | `80`               | Output quality (1–100)                      |
| `format`    | _(same as source)_ | Convert to `webp`, `avif`, `jpeg`, or `png` |

**Examples**

```
GET http://localhost:3000/compress/https://example.com/photo.jpg?quality=70
GET http://localhost:3000/compress/https://example.com/photo.jpg?quality=70&format=webp
```

---

### `POST /upload/compress`

Upload an image, compress/optimize it via imgproxy, and receive back either the **optimized image binary** or a **JSON stats object** — determined by the `Accept` request header.

| `Accept` header         | Response                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `application/json`      | JSON object with compression stats and a download URL (output file persisted, TTL-based cleanup) |
| anything else (default) | Raw optimized image binary (no file persisted)                                                   |

| Query param | Default            | Description                                 |
| ----------- | ------------------ | ------------------------------------------- |
| `quality`   | `80`               | Output quality (1–100)                      |
| `format`    | _(same as source)_ | Convert to `webp`, `avif`, `jpeg`, or `png` |

**Return binary — multipart form upload** (field name `file` or `image`)

```sh
curl -X POST "http://localhost:3000/upload/compress?quality=75&format=webp" \
  -F "file=@/path/to/photo.jpg"
```

**Return binary — raw binary upload**

```sh
curl -X POST "http://localhost:3000/upload/compress?quality=75" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/photo.jpg
```

**Return JSON stats — multipart form upload**

```sh
curl -X POST "http://localhost:3000/upload/compress?quality=75&format=webp" \
  -H "Accept: application/json" \
  -F "file=@/path/to/photo.jpg"
```

**Return JSON stats — raw binary upload** (pass `X-Filename` for original filename)

```sh
curl -X POST "http://localhost:3000/upload/compress?quality=75&format=webp" \
  -H "Accept: application/json" \
  -H "Content-Type: image/jpeg" \
  -H "X-Filename: photo.jpg" \
  --data-binary @/path/to/photo.jpg
```

**JSON response (when `Accept: application/json`)**

```json
{
    "success": true,
    "originalFilename": "photo.jpg",
    "filename": "out-550e8400-e29b-41d4-a716-446655440000.webp",
    "format": "webp",
    "quality": 75,
    "originalSize": 1048576,
    "optimizedSize": 204800,
    "savedSize": 843776,
    "savedPercent": 80.47,
    "downloadUrl": "http://localhost:3000/_/store/out-550e8400-e29b-41d4-a716-446655440000.webp",
    "contentType": "image/webp",
    "ttl": 3600,
    "expiresAt": "2026-02-28T13:00:00.000Z"
}
```

---

## Environment Variables

| Variable                 | Default                            | Description                                                                                                                                                                                         |
| ------------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IMGPROXY_URL`           | `http://imgproxy:8080`             | Base URL of the imgproxy service                                                                                                                                                                    |
| `INTERNAL_URL`           | `http://host.docker.internal:3000` | How imgproxy reaches this server (used by all `/upload/*` endpoints)                                                                                                                                |
| `DATA_STORE_PATH`        | `./store` (relative to app dir)    | Directory for temp uploads and compressed output files. Accepts absolute or relative paths.                                                                                                         |
| `ALLOWED_REMOTE_DOMAINS` | `*`                                | Comma-separated list of allowed source domains. Supports wildcards (`*.example.com`). Use `*` to allow all.                                                                                         |
| `OUTPUT_TTL`             | `3600`                             | Seconds before compressed output files (`out-*`) are eligible for cleanup. Set to `0` to keep forever. Cleanup runs lazily on each `POST /upload/compress` request with `Accept: application/json`. |
| `NODE_ENV`               | —                                  | Set to `development` to use `http://localhost:8888` for imgproxy and `http://localhost:3000` as the internal URL                                                                                    |

---

## Running with Docker Compose

```sh
docker compose up
```

The default [compose.yml](compose.yml) starts both `nextimg-server` (port `3000`) and `imgproxy` together, with auto-WebP/AVIF conversion and ETag caching enabled.

---

## Development

```sh
bun dev
```

---

## Contributors

- [Coollabsio](https://github.com/coollabsio/next-image-transformation)
- Sambo Chea <sombochea@cubetiqs.com>
