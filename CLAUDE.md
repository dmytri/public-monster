# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

public.monster is a nostalgic ~/public_html hosting service that recreates 90s-style personal web hosting. Users upload files via a file manager interface, and their content is instantly served at `public.monster/~username`.

## Commands

```bash
# Development
bun run src/server.ts           # Start server
bun run --hot src/server.ts     # Start with hot reload

# Testing
bun test                         # All tests
bun test tests/server.test.ts    # Specific test file

# Content moderation
bun run run --help               # Show scanner options
bun run run --user ~username     # Scan specific user
```

## Architecture Overview

### Storage & CDN Strategy

The app uses a hybrid storage approach with Bunny.net:
- **Write Path**: Files upload to Bunny Storage via Storage API (`BUNNY_STORAGE_URL`)
- **Read Path**: User sites redirect to Bunny CDN pull zone (`BUNNY_PULL_ZONE`)
- **Internal Access**: API operations use Storage API with `AccessKey` header

All user files live under `/~username/` paths. Metadata files use `/!{userid}/` prefix (e.g., ETags).

### Authentication Flow

`requireAuth()` wrapper (in `src/utils/auth.ts`) protects all API endpoints:
1. Extracts `hanko` cookie with JWT token
2. Calls Hanko API to validate and get user ID
3. Fetches username and validates format (alphanumeric + dash/underscore)
4. Returns frozen `{ userid, username }` object to handlers

**Test Mode**: When `globalThis.TEST` is defined, auth is short-circuited to return test username without Hanko calls.

### Security Model

**Path Safety**: All file paths go through `storagePath()` in `src/utils/paths.ts`, which:
- Resolves paths using `FilePath.posix.resolve()`
- Rejects backslash paths, `..` sequences
- Validates resolved path stays within `/~username/` base
- Throws `InvalidPathError` on violations (caught by Bun.serve error handler)

**Content Safety**: The codebase enforces a whitelist of 60+ allowed file extensions (`ALLOWED_EXTENSIONS` in config) and 5MB size limit.

### ETag-Based Cache Invalidation

The file listing API uses an ETag system to avoid re-fetching unchanged directory listings:
- Each user has an ETag file at `/!{userid}/etag` in Bunny Storage
- `uploadFileHandler` updates the ETag (using hash of `userid + Date.now()`) after successful uploads
- `listFilesHandler` reads the ETag and sends it in response headers
- Client sends `If-None-Match` on subsequent requests; server returns 304 if unchanged

This pattern minimizes data transfer for the file manager interface.

### Test Architecture

Tests use a shared server instance with frozen global state:
- `tests/setup.ts` starts server once with `globalThis.TEST = { username: '_' }`
- All tests run against port 3001 with the same server
- Auth is bypassed in TEST mode (no Hanko API calls)
- No mocks used except for auth; tests hit real storage/APIs in sandbox mode

### Placeholder Replacement Pattern

HTML files in `/public` contain `HANKO_API_URL_PLACEHOLDER` which gets replaced at request time:
- `serveStaticPage()` reads file, replaces placeholder with actual `HANKO_API_URL`
- This allows the same HTML to work across dev/prod without rebuilds
- Used for client-side Hanko auth elements

### Content Moderation System

`utils/list-bunny-accounts.ts` is a standalone scanner that crawls user content:
- Implements three scanning engines: Arachnid Shield (CSAM), GPT-OSS-Safeguard (text), Llama Guard (text+images)
- Uses MD4 hashing for scan result caching in `!moderation/.cache/`
- Employs ETag-based file content caching to skip unchanged files
- Generic scanning interface (`ScannerHandler`) allows pluggable scanners with unified caching

This is separate from the main server and runs as a utility script.

## Development Philosophy

From `QWEN.md` - this codebase enforces strict constraints:
- **Bun primitives only** - Use `Bun.serve()`, `Bun.file()`, `Bun.password`, built-in routing
- **Minimal dependencies** - Only Hanko (auth UI), HTMLHint, PrismJS allowed
- **No defensive code** - Let failures surface organically with clear stack traces
- **No mocks in tests** - Use real services (except auth bypass in TEST mode)
