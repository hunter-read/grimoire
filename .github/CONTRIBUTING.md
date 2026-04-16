# Contributing to Grimoire

Thanks for your interest in contributing! Contributions of all kinds are welcome — bug reports, feature ideas, documentation improvements, code, and translations.

## Reporting a bug or requesting a feature

Open a [GitHub issue](https://github.com/hunter-read/grimoire/issues/new/choose) and pick the template that fits:

- **Bug Report** — something is broken or behaving unexpectedly
- **Feature Request** — an idea or improvement you'd like to see
- **Question / Help** — not sure how something works, or need help getting set up

> Before opening a new issue, a quick search of [existing issues](https://github.com/hunter-read/grimoire/issues) can save time — someone may have already reported the same thing.

### Getting useful logs for bug reports

Docker logs:
```bash
docker compose logs grimoire
```

Admins also have access to the logs on the settings page under the logs tab.

Browser console errors (F12 → Console tab) are also useful for UI problems.

## Translations

Grimoire supports multiple languages and new translations are always welcome! If you'd like to add or improve a translation, take a look at the existing locale files in the frontend for reference on the format and structure.

Open a pull request with your changes — no issue required for translation-only PRs.

## Community

Interested in helping build a community around Grimoire? I'm looking for someone to run a **Discord server** and/or a **subreddit**. If that sounds like you, open an issue or reach out directly.

## Contributing code

1. **Open an issue first** for anything beyond a small fix — it's worth aligning on the approach before you invest time writing code.
2. Fork the repo and create a feature branch off `main`.
3. Make your changes. Run the test suites before opening a PR:

   ```bash
   # Backend
   pytest -q

   # Frontend
   cd frontend && npm test
   ```

4. Open a pull request against `main`. The PR template will prompt you for a summary and testing notes.

## Project structure

```
grimoire/
├── backend/        # FastAPI application (Python)
│   ├── routers/    # API route handlers
│   └── models.py   # SQLAlchemy ORM models
├── frontend/       # React 18 SPA
│   ├── src/
│   │   ├── components/
│   │   ├── views/
│   │   ├── hooks/
│   │   └── context/
└── tests/          # Backend pytest test suite
```

## Development setup

The easiest way to get a local dev environment running is with the included Docker Compose dev file:

```bash
docker compose -f docker-compose.dev.yml up
```

See the [README](../README.md#running-without-docker) for instructions on running Grimoire locally without Docker.

## Security vulnerabilities

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for how to report them privately.
