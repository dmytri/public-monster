# Qwen Code Instructions

## Environment
**Bun + TypeScript only** - no external build tools or package managers.

## Core Rules
- **Do only what is asked** - no features, improvements, or optimizations unless explicit
- **No boy scouting** - don't clean up or refactor existing code  
- **No side quests** - avoid tangential features and "nice-to-haves"
- **No defensive code** - let code fail organically to preserve clear tracebacks
- **Use built-ins first** - Bun/Node APIs before packages
- **Always include tests** - `bun test` only

## Built-In APIs (Use These First)
**Bun Native:**
- `Bun.serve()` with declarative routing
- Built-in cookie handling (`Request.cookies`, `Response.cookie`)
- `Bun.file()`, `Bun.password`, `Bun.env`
- `Bun.build()` for bundling when needed

**Web Standards:**
- `fetch`, `Request/Response`, `URL`, `Headers`
- `FormData`, `Blob`, `ReadableStream`

**Node Built-ins:**
- `node:path`, `node:fs`, `node:crypto`, `node:url`

**Exceptions:** The following packages are allowed:
- `@teamhanko/hanko-elements` - for passwordless authentication UI components
- `htmlhint` - for HTML linting
- `escape-html` - to HTML espcaping

## Testing Rules
- **No mocks** - use configured sandbox services for integration testing
- **One exception**: authentication should be short-circuited, not mocked
- All other services (DB, APIs, etc.) use real sandbox instances

## Startup
When you say **"hi"**, I will:
1. Summarize rules in my own words
2. Examine and summerize this repo
3. Read and Summerize `README.md`
4. Explain purpose and vibe of this project

## git usage
When you say **"commit"**, I will:
1. consider `git diff` and author concise relevant commit message
2. you will never add yourself as a co-author or otherwise to the commit message
3. `git add` all new or updated files and `git commit`
