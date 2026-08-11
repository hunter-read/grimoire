<div align="center">
  <img src="frontend/static/android-chrome-192x192.png" alt="Grimoire" width="144">

  # Grimoire - Self-Hosted TTRPG Library Manager

  [![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/9Sd4CGZC63)
  [![CI](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml/badge.svg)](https://github.com/hunter-read/grimoire/actions/workflows/ci.yml)
  [![Python](https://img.shields.io/badge/python-3.12-blue?logo=python&logoColor=white)](https://www.python.org/)
  [![React](https://img.shields.io/badge/react-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
  [![License](https://img.shields.io/github/license/hunter-read/grimoire)](LICENSE)
  [![Stars](https://img.shields.io/github/stars/hunter-read/grimoire)](https://github.com/hunter-read/grimoire/stargazers)

  **[Website](https://grimoirecodex.org)**  ·  **[Documentation](https://docs.grimoirecodex.org)**  ·  **[Live Demo](https://demo.grimoirecodex.org)**  ·  **[Join our Discord](https://discord.gg/9Sd4CGZC63)**
</div>


A Docker-based web application for managing your tabletop RPG PDF collection. Browse, search, and read your entire library from any device with a clean, responsive UI.

## Docker Image Tags

Images are published to [Docker Hub](https://hub.docker.com/r/hunterreadca/grimoire). Pull with:

```bash
docker pull hunterreadca/grimoire:<tag>
```

Every release is published under several tags so you can choose how tightly to
pin. Given a release `v1.4.2`, the same image is pushed as `1.4.2`, `1.4`, and
`1`, and `latest` is moved to point at it:

| Tag       | Example (for release `v1.4.2`) | Updates when you re-pull                                                                 |
| --------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `latest`  | `latest`                       | Always the most recent stable release. **Recommended for most deployments.**             |
| `X`       | `1`                            | **Major** version - the newest release in the `1.x.x` line. Follows new features and patches, but never a breaking `2.0.0`. |
| `X.Y`     | `1.4`                          | **Minor** version - the newest patch in the `1.4.x` line. Gets bug-fix patches only, not the new features introduced by `1.5`. |
| `X.Y.Z`   | `1.4.2`                        | **Patch** version - an exact, immutable release. Never changes. Use to fully pin a deployment. |
| `nightly` | `nightly`                      | Daily build off `main`, rebuilt only when `main` has changed. Tracks what's landed since the last release; not a release itself. |
| `edge`    | `edge`                         | Published irregularly from in-progress work. Highly volatile and unsupported - see below before using it. |

The version parts follow semantic versioning: the **major** (`X`) bumps for
breaking changes, the **minor** (`X.Y`) for new features, and the **patch**
(`X.Y.Z`) for bug fixes. Pick based on how much you want automatic updates:
`latest`/`X` for "keep me current," `X.Y` for "new features are fine but no
breaking changes," `X.Y.Z` to freeze exactly.

### Edge builds

The `edge` tag is built **on demand from in-progress work**, not on a schedule
and not from a branch that has necessarily passed review. It exists to get a
specific change onto a real deployment quickly.

What that means for you:

- **No cadence.** It may be rebuilt several times in a day, or sit untouched for
  weeks. A stale `edge` is not a signal that anything is wrong, and a fresh one
  is not a signal that anything is ready.
- **No continuity between pulls.** Two `edge` images days apart can contain
  unrelated work, and the newer one may not contain what the older one did.
  Features can appear, change shape, or disappear again.
- **Expect breakage.** It can carry half-finished features, debug output, schema
  changes still being iterated on, or bugs that never reach `nightly`.
- **Unsupported.** Bug reports against `edge` are hard to act on, since the exact
  image may no longer exist. Please reproduce on `nightly` or a release tag
  first.

> **Do not use `edge` for a real library.** Point it at throwaway data you can
> afford to lose. If you want to track development, use `nightly` - it builds
> from `main`, which has at least been through CI.

### Slim variant (no OCR)

The default image bundles the [Tesseract](https://github.com/tesseract-ocr/tesseract)
OCR engine so scanned/image-only PDFs become searchable. If you don't need OCR,
the **slim** image drops it for a smaller download and footprint.

Each release tag above has a matching slim tag with a `-slim` suffix, plus a
plain `slim` tag that tracks the latest stable slim release (the slim equivalent
of `latest`):

| Tag         | Example (for release `v1.4.2`) | Description                                                        |
| ----------- | ------------------------------ | ----------------------------------------------------------------- |
| `slim`      | `slim`                         | Latest stable slim release (slim equivalent of `latest`).         |
| `X-slim`    | `1-slim`                       | Newest slim image in the major (`1.x.x`) line.                    |
| `X.Y-slim`  | `1.4-slim`                     | Newest slim image in the minor (`1.4.x`) line.                    |
| `X.Y.Z-slim`| `1.4.2-slim`                   | Exact, immutable slim release.                                    |

```bash
docker pull hunterreadca/grimoire:slim
```

There are no `nightly-slim` or `edge-slim` tags - both are only published as the
full (OCR) image. Dropping Tesseract saves only ~20 MB now, which isn't worth
doubling those build times; the slim variant remains available on release tags.

### Supported Architectures

| Architecture       | Supported |
| ------------------ | --------- |
| `linux/amd64`      | ✅        |
| `linux/arm64`      | ✅        |

Docker automatically pulls the correct image for your platform.

## Quick Start

```bash
docker run -d \
 --name grimoire \
 -p 9481:9481 \
 -v /path/to/library:/library \
 -v /path/to/data:/data \
  hunterreadca/grimoire:latest
```

Then open <http://localhost:9481>.

See the [documentation](https://docs.grimoirecodex.org) for full configuration, environment variables, and `docker-compose` examples.

---

## License

GNU General Public License v3.0
