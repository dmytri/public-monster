# Qwen Code Instructions

## Core Principles

- **Always do the minimum work** - Focus on the essential requirements only
- **Always confirm anything ambiguous** - Seek clarification before proceeding with unclear requirements
- **Be very dependency adverse** - Avoid adding unnecessary dependencies; prefer existing solutions
- **Follow YAGNI (You Aren't Gonna Need It)** - Implement only what is currently needed, not what might be needed later
- **Do the simplest thing that could possibly work** - Choose the most straightforward solution that satisfies the requirements
- **Always add tests** - Include tests for all implemented functionality to ensure quality and prevent regressions
- **Follow instructions precisely** - Only implement exactly what is requested, without adding additional functionality beyond the specific request

## Project-Specific Notes

- This is a **Bun project** - Use `bun` commands instead of `npm`, `yarn`, or `pnpm`
- Use `bun test` instead of `npm test` or other test runners
- Use `bun run` instead of `npm run` for scripts
- Do not use `tsc`, `npm install`, `yarn install`, or similar commands unless specifically instructed
- The project uses Bun's native TypeScript support
- To verify the project functionality, run the tests with `bun test` - there's no need to manually start the server as comprehensive tests cover all functionality