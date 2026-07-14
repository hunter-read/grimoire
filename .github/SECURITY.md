# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Public disclosure before a fix is available puts other Grimoire users at risk.

Instead, use GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/hunter-read/grimoire/security) of this repository.
2. Click **"Report a vulnerability"**.
3. Fill in as much detail as you can (see below).

You'll receive a response as soon as possible. For valid vulnerabilities, a fix will be prepared and a coordinated disclosure made once it is ready.

## What to include in your report

The more detail you provide, the faster the issue can be assessed and fixed:

- **Description** - what the vulnerability is and what it allows an attacker to do
- **Steps to reproduce** - a minimal sequence of steps or a proof-of-concept
- **Impact** - who is affected and under what conditions
- **Suggested fix** - if you have one (optional but appreciated)

## Scope

Grimoire is a self-hosted application. The following are considered in scope:

- Authentication and authorization bypasses
- Server-side vulnerabilities (injection, path traversal, insecure file handling, etc.)
- Exposure of user data or credentials
- OPDS feed access control issues

The following are generally out of scope:

- Vulnerabilities that require physical access to the host machine
- Denial-of-service attacks that require a large number of requests
- Issues in third-party dependencies (please report those upstream)

## Supported versions

Only the latest release is actively maintained. If you are running an older version, please update before reporting.
