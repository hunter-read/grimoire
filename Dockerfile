# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Python dependencies (compilers live here, not in the runtime image)
FROM python:3.12-slim AS backend-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 3: Runtime image (no build toolchain)
FROM python:3.12-slim

WORKDIR /app

# `unar` provides RAR extraction for rarfile (used to render .cbr cover
# thumbnails); without it .cbr archives are still served, just without a cover.
RUN apt-get update && apt-get install -y --no-install-recommends \
    unar \
    && rm -rf /var/lib/apt/lists/*

# Bring in the pre-built Python packages from the builder stage.
COPY --from=backend-builder /install /usr/local

COPY backend/ ./backend/
COPY alembic.ini ./alembic.ini
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /data /library

ARG APP_VERSION=dev
ARG COMMIT_HASH="dev"
ENV APP_VERSION=${APP_VERSION}
ENV COMMIT_HASH=${COMMIT_HASH}
ENV PYTHONUNBUFFERED=1

EXPOSE 9481

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:9481/api/health', timeout=4).status == 200 else 1)" || exit 1

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "9481", "--workers", "2"]
