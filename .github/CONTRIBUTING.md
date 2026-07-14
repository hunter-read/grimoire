# Contributing to Grimoire

Thanks for your interest in contributing! Contributions of all kinds are welcome - bug reports, feature ideas, documentation improvements, code, and translations.

## Reporting a bug or requesting a feature

Open a [GitHub issue](https://github.com/hunter-read/grimoire/issues/new/choose) and pick the template that fits:

- **Bug Report** - something is broken or behaving unexpectedly
- **Feature Request** - an idea or improvement you'd like to see
- **Question / Help** - not sure how something works, or need help getting set up

> Before opening a new issue, a quick search of [existing issues](https://github.com/hunter-read/grimoire/issues) can save time - someone may have already reported the same thing.

### Getting useful logs for bug reports

Docker logs:
```bash
docker compose logs grimoire
```

Admins also have access to the logs on the settings page under the logs tab.

Browser console errors (F12 → Console tab) are also useful for UI problems.

## Translations

Grimoire supports multiple languages, and new or improved translations are always welcome.

If you would like to contribute, please review the existing locale files in the frontend to follow the current format and structure. I am proficient in English and passable in French. For some other languages, I use AI-assisted translations and then validate them with help from a few of my players, so there may still be mistakes we do not catch.

If you find a translation issue or want to contribute but do not want to open a pull request, please reach out on Discord and we can coordinate there.

If you do want to submit changes, feel free to open a pull request directly. No issue is required for translation-only PRs.

## Community

Join the [Discord server](https://discord.gg/9Sd4CGZC63) to chat, share feedback, or get help.

## Contributing code

1. **Open an issue first** for anything beyond a small fix - it's worth aligning on the approach before you invest time writing code.
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

See [docs/running-from-source.md](../docs/running-from-source.md) for instructions on building the image yourself or running Grimoire locally without Docker.

## Security vulnerabilities

Please do **not** open a public issue for security vulnerabilities. See [SECURITY.md](SECURITY.md) for how to report them privately.
