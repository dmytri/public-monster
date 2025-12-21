# public.monster - AI Agent Guide

## Project Overview

public.monster is a nostalgic ~/public_html hosting service that recreates the magic of 90s personal web hosting. Users upload HTML, CSS, and other web files through a file manager interface, and their content is instantly served at `public.monster/~username`. The project embraces the philosophy of keeping web hosting simple, fun, and accessible to everyone.

**Core Philosophy:** "Remember when the web was fun?" - No build steps, no frameworks, no deployment pipelines. Just pure, unfiltered creativity like the 90s web.

## Technology Stack

- **Runtime:** Bun (JavaScript/TypeScript)
- **Authentication:** Hanko (passwordless auth with magic links)
- **Storage:** Bunny.net Storage API + CDN (hybrid approach)
- **Deployment:** Docker containers on Bunny.net edge
- **Testing:** Bun test with happy-dom for E2E
- **Content Moderation:** Arachnid Shield (CSAM detection)

## Architecture

### Storage Strategy
The app uses a hybrid Bunny.net approach:
- **Write Path:** Files upload to Bunny Storage via Storage API
- **Read Path:** User sites redirect to Bunny CDN pull zone
- **Internal Access:** API operations use Storage API with AccessKey header

All user files live under `/~username/` paths. Metadata files use `/!{userid}/` prefix.

### Authentication Flow
`requireAuth()` wrapper protects all API endpoints:
1. Extracts `hanko` cookie with JWT token
2. Validates with Hanko API to get user ID
3. Fetches username and validates format (alphanumeric + dash/underscore)
4. Returns frozen `{ userid, username }` object

**Test Mode:** When `globalThis.TEST` is defined, auth short-circuits to return test credentials.

### Security Model
- **Path Safety:** All file paths go through `storagePath()` which prevents directory traversal
- **Content Safety:** Whitelist of 60+ allowed file extensions, 5MB size limit
- **CSAM Detection:** Arachnid Shield integration for media files

### ETag-Based Cache Invalidation
- Each user has ETag file at `/!{userid}/etag` in Bunny Storage
- Updated after successful uploads
- Client sends `If-None-Match` for subsequent requests
- Server returns 304 if unchanged

## Code Organization

```
src/
├── server.ts          # Entry point
├── app.ts            # Main server setup and routing
├── handlers/
│   ├── api/          # API endpoints (files, zip, migration, starter)
│   └── static.ts     # Static page serving
└── utils/
    ├── auth.ts       # Authentication logic
    ├── config.ts     # Environment validation and constants
    └── paths.ts      # Path validation and security

public/                 # Static HTML pages
├── index.html        # Main landing page
├── filemanager.html  # File upload/management interface
└── [other pages]     # About, FAQ, TOS, etc.

tests/                  # Test suite
├── server.*.test.ts  # Security and API tests
├── e2e.*.test.ts     # End-to-end DOM interaction tests
└── helpers.ts        # Test utilities
```

## Development Commands

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

## Testing Strategy

### Core Principles
- **NO MOCKS** (except Shield API flagged responses)
- **NO DEFENSIVE CODE** in tests - let failures surface
- **Real services** - Use sandboxed Bunny Storage, real server
- **Bun test only** - No Jest/Vitest/Mocha

### Test Categories

**Server Tests** (`tests/server.*.test.ts`)
- Path traversal prevention
- Authentication/authorization
- File extension whitelist enforcement
- File size limits
- Shield CSAM scanning integration

**E2E Tests** (`tests/e2e.*.test.ts`)
- DOM interactions via happy-dom (NOT headless browsers)
- Real HTML fetched from server
- Form submissions, button clicks, file uploads
- Auth UI state changes

**Unit Tests** (rare - only for complex pure functions)

### Test Setup
- Global server instance with `globalThis.TEST` frozen state
- Auth bypass in TEST mode (no Hanko API calls)
- Port hashing for parallel execution
- Real Bunny Storage sandbox credentials

## Environment Variables

Required for development/production:
```bash
HANKO_API_URL=https://your-project.hanko.io
BUNNY_STORAGE_URL=https://storage.bunnycdn.com/public-monster
BUNNY_API_KEY=your-bunny-api-key
ARACHNID_API_USERNAME=your-arachnid-username
ARACHNID_API_PASSWORD=your-arachnid-password
```

Optional:
```bash
BUNNY_PULL_ZONE=https://your-pull-zone.b-cdn.net
```

## Deployment

Production deployment uses Ansible playbook:
```bash
export HANKO_API_URL=https://your-project.hanko.io
export DOCKERHUB_USERNAME=yourname
export DOCKERHUB_TOKEN=xxx
export BUNNY_API_KEY=xxx

ansible-playbook deploy.yml
```

## Code Style Guidelines

### Bun Primitives First
- Use `Bun.serve()` with declarative routing
- Built-in cookie handling (`Request.cookies`, `Response.cookie`)
- `Bun.file()`, `Bun.password`, `Bun.env`
- Web standards: `fetch`, `Request/Response`, `FormData`

### Allowed Dependencies (Minimal)
- `@teamhanko/hanko-elements` - auth UI components
- `htmlhint` - HTML linting
- `prismjs` - source code viewing
- `arachnid-shield-sdk` - CSAM detection

### Security Patterns
- All user paths must go through `storagePath()` validation
- File extension whitelist enforcement
- Path traversal detection and rejection
- Content moderation for media files

### Error Handling
- **No defensive code** - let failures surface with clear stack traces
- Use `InvalidPathError` for path validation failures
- Proper HTTP status codes (400, 403, 404, 451)

## Content Moderation

The project includes a standalone content scanner (`utils/list-bunny-accounts.ts`) that:
- Implements three scanning engines: Arachnid Shield (CSAM), GPT-OSS-Safeguard (text), Llama Guard (text+images)
- Uses MD4 hashing for scan result caching
- Employs ETag-based file content caching
- Generic scanning interface for pluggable scanners

## Key Constraints

From QWEN.md and TESTING_POLICY.md:
- **Do only what is asked** - no features/improvements unless explicit
- **No boy scouting** - don't clean up or refactor existing code
- **No side quests** - avoid tangential features
- **No defensive code** - preserve clear tracebacks
- **Always include tests** - `bun test` only
- **No mocks** - use real sandbox services (except Shield flagged responses)

This is a carefully crafted project that balances nostalgia with modern security and reliability. The codebase is intentionally minimal and focused, avoiding the complexity that has come to define modern web development.