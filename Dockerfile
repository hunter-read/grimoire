# Stage 1: Build frontend
# Pinned to BUILDPLATFORM: the Vite bundle is architecture-independent, so on a
# multi-arch build this stage runs once natively instead of once per target
# platform (the arm64 pass would otherwise run the whole build under QEMU).
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Python dependencies (compilers live here, not in the runtime image)
FROM python:3.12-slim AS backend-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
# Strip debug symbols from the compiled extensions (pymupdf, uvloop, cryptography
# and friends ship them unstripped). --strip-unneeded leaves the dynamic symbols
# needed for linking, so this is a pure size win: ~40 MB off the runtime image.
# `strip` comes from binutils, already present as a dependency of gcc/g++ above.
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt \
    && find /install -name '*.so*' -type f -exec strip --strip-unneeded {} + || true \
    && rm -rf /install/lib/python3.12/site-packages/pymupdf/mupdf-devel \
    && find /install -name '__pycache__' -type d -prune -exec rm -rf {} +

# Stage 3: Runtime base shared by both variants (no build toolchain)
FROM python:3.12-slim AS runtime-base

WORKDIR /app

# `unar` (RAR extraction for .cbr cover thumbnails) is installed per final stage
# rather than here — see the comment on the slim stage for why.

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

ENV WORKERS=2
CMD ["sh", "-c", "exec python -m uvicorn backend.main:app --host 0.0.0.0 --port 9481 --workers ${WORKERS}"]

# Stage 4a: Slim variant — no OCR engine. Grimoire degrades gracefully: image-only
# PDFs stay excluded from full-text search, exactly as before OCR was added. Built
# with `--target slim` and published under the `-slim` tag family.
FROM runtime-base AS slim

# `unar` provides RAR extraction for rarfile (used to render .cbr cover
# thumbnails); without it .cbr archives are still served, just without a cover.
# It is the only tool in Debian main that can actually decompress RAR:
# p7zip-full parses RAR headers but fails to extract ("Unsupported Method" —
# the codec is in the non-free p7zip-rar), and bsdtar handles RAR5 but exits 1
# on solid RAR3, a common CBR layout.
#
# Everything after the install undoes the damage its dependency chain does:
# gnustep-base-runtime hard-Depends on graphviz, which drags in the AV1/HEIF
# codecs, X11 and pango, and gnustep-common pulls perl. None of it appears in
# `ldd $(which unar)`. gnustep does shell out to dpkg-architecture for one
# constant string, so that is replaced with a shell stub before perl goes.
#
# This has to be one RUN, and it has to be per final stage:
#   * install and purge in separate layers leaves the removed files in the
#     lower layer, so the image does not actually shrink (~50 MB).
#   * --force-depends leaves the dpkg database inconsistent, so any later
#     apt-get install in the same image refuses to run — which rules out
#     sharing this in runtime-base ahead of the OCR stage's tesseract install.
RUN apt-get update && apt-get install -y --no-install-recommends unar \
    && ARCH="$(dpkg-architecture -qDEB_HOST_MULTIARCH)" \
    && dpkg --remove --force-depends \
        graphviz libgvc6 libgvpr2 libcdt5 libcgraph6 libpathplan4 liblab-gamut1 \
        libann0 libgts-0.7-5t64 \
        libaom3 libsvtav1enc2 librav1e0.7 libdav1d7 libgav1-1 libavif16 libheif1 \
        libheif-plugin-dav1d libheif-plugin-libde265 libde265-0 libyuv0 \
        binutils binutils-common binutils-aarch64-linux-gnu binutils-x86-64-linux-gnu \
        libbinutils libgprofng0 libctf0 libctf-nobfd0 libsframe1 \
        libgd3 libxpm4 libxaw7 libxmu6 libxt6t64 libsm6 libice6 \
        perl perl-modules-5.40 libperl5.40 libgdbm-compat4t64 dpkg-dev libdpkg-perl \
        2>/dev/null || true \
    && rm -rf /usr/share/perl /usr/share/perl5 /usr/lib/*/perl \
    && printf '#!/bin/sh\necho "%s"\n' "$ARCH" > /usr/bin/dpkg-architecture \
    && chmod +x /usr/bin/dpkg-architecture \
    && rm -rf /var/lib/apt/lists/*

# Stage 4b: Default variant — bundles Tesseract + English language data so image-only
# PDFs are OCR'd into the full-text index out of the box. Extra languages can be added
# at runtime by mounting tessdata and setting OCR_LANGUAGES (see README); no rebuild
# required. This is the last stage, so a plain `docker build` (no --target) yields it.
FROM runtime-base AS ocr

# Same unar install + dependency purge as the slim stage (see the comment there
# for why it is one RUN and repeated per stage), with tesseract added to the
# same apt transaction so it lands before the dpkg database is made
# inconsistent.
#
# osd.traineddata (10.5 MB — larger than the English data itself) is only read
# for orientation/script detection, i.e. image_to_osd() or --psm 0. Grimoire
# only ever calls image_to_string() with an explicit lang, so it is never
# loaded. Mounting your own tessdata for OCR_LANGUAGES is unaffected.
RUN apt-get update && apt-get install -y --no-install-recommends \
        unar \
        tesseract-ocr \
        tesseract-ocr-eng \
    && ARCH="$(dpkg-architecture -qDEB_HOST_MULTIARCH)" \
    && rm -f /usr/share/tesseract-ocr/*/tessdata/osd.traineddata \
    && dpkg --remove --force-depends \
        graphviz libgvc6 libgvpr2 libcdt5 libcgraph6 libpathplan4 liblab-gamut1 \
        libann0 libgts-0.7-5t64 \
        libaom3 libsvtav1enc2 librav1e0.7 libdav1d7 libgav1-1 libavif16 libheif1 \
        libheif-plugin-dav1d libheif-plugin-libde265 libde265-0 libyuv0 \
        binutils binutils-common binutils-aarch64-linux-gnu binutils-x86-64-linux-gnu \
        libbinutils libgprofng0 libctf0 libctf-nobfd0 libsframe1 \
        libgd3 libxpm4 libxaw7 libxmu6 libxt6t64 libsm6 libice6 \
        perl perl-modules-5.40 libperl5.40 libgdbm-compat4t64 dpkg-dev libdpkg-perl \
        2>/dev/null || true \
    && rm -rf /usr/share/perl /usr/share/perl5 /usr/lib/*/perl \
    && printf '#!/bin/sh\necho "%s"\n' "$ARCH" > /usr/bin/dpkg-architecture \
    && chmod +x /usr/bin/dpkg-architecture \
    && rm -rf /var/lib/apt/lists/*
