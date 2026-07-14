# Running from source

Grimoire ships as a Docker image and that's the recommended way to run it (see the
[README Quick Start](../README.md#quick-start)). If you'd rather build the image yourself
or run the app directly on the host - for development, or on a platform where Docker isn't
an option - this guide covers both.

For contributor setup (local dev environment, tests, coding standards) see
[CONTRIBUTING.md](../.github/CONTRIBUTING.md).

---

## Build the Docker image from source

```bash
docker build --build-arg APP_VERSION=1.5.0 -t grimoire:1.5.0 .
```

By default this builds the OCR-capable image (bundles Tesseract). To build the smaller
slim variant without OCR, target the `slim` stage:

```bash
docker build --target slim --build-arg APP_VERSION=1.5.0 -t grimoire:1.5.0-slim .
```

See [OCR](../README.md#ocr) for the difference between the two variants.

---

## Running without Docker

If you prefer to run Grimoire directly on the host, you need Python 3.12+ and Node 20+.

### 1. Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

This produces a `frontend/dist/` directory that the backend serves as static files.

### 2. Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Set environment variables

```bash
export SECRET_KEY=$(openssl rand -hex 32)
export LIBRARY_PATH=/path/to/your/library
export DATA_PATH=/path/to/your/data
```

See [Configuration](../README.md#configuration) for the full list of environment variables.

### 4. Start the server

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 9481
```

Open `http://localhost:9481`. On first launch you'll be prompted to create an admin account.

Persistent data and upgrades work the same as under Docker - see
[Persistent data](../README.md#persistent-data) and [Upgrading](../README.md#upgrading).

### Optional: Valkey/Redis page cache

Set `VALKEY_URL` to a Redis-compatible URL to enable in-memory page caching:

```bash
export VALKEY_URL=redis://localhost:6379/0
```

Without it, rendered pages are cached to disk under `DATA_PATH`.
