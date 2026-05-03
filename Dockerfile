# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python app
FROM python:3.12-slim AS backend-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    mupdf-tools \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt .

# Install into a relocatable prefix so we can copy it into the final image
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 3: Runtime (hardened)
FROM dhi.io/python:3.12

WORKDIR /app

# Python deps
COPY --from=backend-builder /install /usr/local

# MuPDF runtime bits
COPY --from=backend-builder /usr/bin/mutool /usr/bin/mutool
COPY --from=backend-builder /usr/bin/mupdf* /usr/bin/

# App code + built frontend
COPY backend/ ./backend/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN mkdir -p /data /library

ARG APP_VERSION=dev
ARG COMMIT_HASH="dev"
ENV APP_VERSION=${APP_VERSION}
ENV COMMIT_HASH=${COMMIT_HASH}
ENV PYTHONUNBUFFERED=1

EXPOSE 9481

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "9481", "--workers", "2"]
