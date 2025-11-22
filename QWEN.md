# Qwen Code Instructions

## Environment
**Bun + TypeScript only** - no external build tools or package managers.

## Core Rules
- **Do only what is asked** - no features, improvements, or optimizations unless explicit
- **No boy scouting** - don't clean up or refactor existing code  
- **No side quests** - avoid tangential features and "nice-to-haves"
- **No defensive code** - let code fail organically to preserve clear tracebacks
- **Confirm anything unclear** - stop and ask about ambiguity
- **Use built-ins first** - Bun/Node APIs before packages
- **Implement only what's needed now** - no speculative work
- **Keep it simple** - choose simplest working solution
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

**No Express, Koa, cookie-parser, axios, dotenv, or similar packages.**

**Exceptions:** The following packages are allowed:
- `@teamhanko/hanko-elements` - for passwordless authentication UI components
- `htmlhint` - for HTML linting

## Testing Rules
- **No mocks** - use configured sandbox services for integration testing
- **One exception**: authentication should be short-circuited, not mocked
- All other services (DB, APIs, etc.) use real sandbox instances
- Tests should reflect actual runtime behavior

## Startup
When you say **"hi"**, I will:
1. **Summarize rules** in my own words
2. **Explain project** examine repo and explain purpose

Failure to do both means I didn't read the rules.
