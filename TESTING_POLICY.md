# Testing Policy

This document defines the testing philosophy and guidelines for public.monster. These rules ensure tests are reliable, maintainable, and accurately reflect production behavior.

## Core Principles

### 1. NO MOCKS (Except One Exception)

**Use real sandboxed services** configured via `.env` for all testing:
- Bunny Storage API calls hit real sandbox storage
- All HTTP endpoints tested against actual server
- File operations use real filesystem paths

**Why?** Mocks create a maintenance burden and can drift from actual service behavior, leading to false confidence.

**The ONE Exception:** Shield API flagged responses (explained below)

### 2. NO DEFENSIVE CODE in Tests

Let failures surface organically with clear stack traces. Do not add:
- Try/catch blocks that swallow errors
- Fallback logic that masks problems
- Defensive null checks that hide bugs

**Why?** Defensive code obscures the root cause of failures. Clean stack traces are more valuable than "safe" tests.

### 3. Short-Circuiting Over Mocking

**Authentication bypass:** When `globalThis.TEST` is defined, the auth layer short-circuits and returns test user credentials without calling Hanko API.

```typescript
// In src/utils/auth.ts
if (typeof globalThis.TEST !== 'undefined') {
  return { userid: 'test-user-id', username: globalThis.TEST.username };
}
```

This is **NOT a mock** - it's a conditional code path that exists in the production codebase.

**Why?** This approach:
- Requires no test doubles or stub endpoints
- Works with real request/response objects
- Tests actual code paths (just skips external API)

### 4. Bun Test Only

Use `bun test` exclusively. No Jest, Vitest, Mocha, or other test frameworks.

**Why?** Consistency with the development environment and minimal dependencies.

## Test Categories

### Server Tests (`tests/server.*.test.ts`)

**Purpose:** Test security and safety concerns that don't depend on client behavior.

**What to test:**
- Path traversal prevention
- Authentication/authorization
- File extension whitelist enforcement
- File size limits
- Shield CSAM scanning integration
- Content-Type validation
- ETag cache invalidation
- Endpoint security (400/403/451 responses)

**What NOT to test:**
- Business logic that can be tested via e2e
- Functionality that requires client state
- UI rendering or DOM manipulation

**Example:**
```typescript
test("POST /api/files - rejects path traversal attempts", async () => {
  const form = new FormData();
  form.append("file", new Blob(["test"]));
  form.append("path", "../../../etc/passwd");

  const res = await fetch(`${BASE_URL}/api/files`, {
    method: "POST",
    body: form,
  });

  expect(res.status).toBe(400);
  expect(await res.text()).toBe("Invalid file path");
});
```

### E2E Tests (`tests/e2e.*.test.ts`)

**Purpose:** Test client-dependent functionality through actual DOM interactions.

**Tools:**
- **happy-dom** for DOM simulation (NOT headless browsers like Puppeteer/Playwright)
- Real server running in TEST mode
- Actual HTML fetched from server

**Rules:**
1. **Fetch the page first:** Get HTML from server via `fetch(BASE_URL)`
2. **Parse with happy-dom:** Create `Window` instance with real HTML
3. **Interact via DOM:** Use `.click()`, `.dispatchEvent()`, form submissions
4. **NO direct API calls** except:
   - Fetching the initial page HTML
   - Test setup (uploading fixture files)
5. **Verify via DOM state** or subsequent API calls

**Example:**
```typescript
test("File upload through DOM interaction", async () => {
  // 1. Fetch real HTML
  const response = await fetch(`${BASE_URL}/`);
  const htmlContent = await response.text();

  // 2. Create DOM
  const window = new Window({ url: `${BASE_URL}/` });
  const { document } = window;
  document.write(htmlContent);

  // 3. Set up test environment
  (window as any).hankoToken = 'test-token';

  // 4. Create mock file and set on input
  const file = new File(['content'], 'test.txt', { type: 'text/plain' });
  const filesInput = document.getElementById('files') as HTMLInputElement;
  Object.defineProperty(filesInput, 'files', { value: [file] });

  // 5. Trigger via DOM event
  filesInput.dispatchEvent(new window.Event('change'));
  const form = document.getElementById('uploadForm');
  form.dispatchEvent(new window.Event('submit'));

  // 6. Wait and verify via API (not DOM, since async)
  await Bun.sleep(1000);
  const listResponse = await fetch(`${BASE_URL}/api/files`);
  const files = await listResponse.json();
  expect(files.some(f => f.ObjectName === "test.txt")).toBe(true);
});
```

**What to test:**
- Complete user flows (upload → list → delete)
- Form interactions and validation
- Button click handlers
- Progress indicators
- Error message display
- Auth UI state changes (login button visibility, username display)
- File tree rendering
- Migration flows

**What NOT to test:**
- Module script execution (happy-dom limitation - replicate logic instead)
- Full FileList API (requires workarounds)
- Network failures (test server-side)

### Unit Tests (`tests/unit.*.test.ts`)

**Purpose:** Test pure utility functions with complex logic.

**When to use:** Rarely. Only for functions like:
- `storagePath()` - complex path validation logic
- `isShieldScannableFile()` - extension matching
- Pure formatters/parsers

**Prefer integration/e2e** for most functionality.

**Example:**
```typescript
test("storagePath validates traversal attempts", async () => {
  await expect(storagePath('user', '../../../etc/passwd')).rejects.toThrow();
  await expect(storagePath('user', 'folder/../../etc/passwd')).rejects.toThrow();
  await expect(storagePath('user', '..\\windows')).rejects.toThrow();
});
```

## Special Cases

### Shield CSAM Scanning Tests (Mock Exception)

Shield API is the **ONLY** acceptable use of mocking because we will never have CSAM fixtures.

**Three test scenarios:**

1. **Happy path (real):** Upload real fixture image → Shield scans → returns safe → upload succeeds
2. **Blocked content (mocked):** Upload real image → mock Shield to return `is_match: true` → expect 451 status
3. **Fail-open (mocked):** Upload real image → mock Shield to throw error → upload succeeds

**Implementation approach:**
```typescript
// Use a real test image fixture
const imageFile = Bun.file('tests/fixtures/test-image.png');

// For flagged response, temporarily replace Shield API method
const originalScan = ArachnidShield.prototype.scanMediaFromBytes;
ArachnidShield.prototype.scanMediaFromBytes = async () => ({
  status: 'ok',
  data: { is_match: true, classification: 'test_violation' }
});

// ... upload test ...

// Restore original
ArachnidShield.prototype.scanMediaFromBytes = originalScan;
```

**Why this exception?** We will not ever have CSAM content for testing, but blocking flagged content is a critical safety feature that must be tested.

### Auth Testing

**Server auth bypass:** Use `globalThis.TEST` short-circuit (as described above)

**E2E auth tests:** Test only DOM behavior:
- Login button visibility when `username` element is empty
- Upload form visibility based on auth state
- Username display after "authentication"

**Do NOT test:**
- Hanko API integration (covered by Hanko's own tests)
- JWT validation logic (trust the library)
- Session persistence across page loads (browser behavior)

## Test File Organization

```
tests/
├── setup.ts                      # Global test server startup (preload)
├── helpers.ts                    # Shared test utilities
├── fixtures/                     # Test assets
│   ├── test-image.png           # Safe image for Shield tests
│   └── sample.html              # HTML fixtures for validation
├── server.smoke.test.ts         # Basic CRUD operations
├── server.security.test.ts      # Path traversal, extension whitelist
├── server.shield.test.ts        # Shield integration tests
├── server.endpoints.test.ts     # Endpoint-specific security tests
├── e2e.index.test.ts            # Home page interactions
├── e2e.filemanager.test.ts      # File manager UI operations
├── e2e.upload.test.ts           # Upload flow with errors
├── e2e.validate.test.ts         # HTML validator page
├── e2e.profile.test.ts          # Migration flow
├── e2e.auth.test.ts             # Auth UI behavior
├── unit.paths.test.ts           # Path validation edge cases
└── unit.config.test.ts          # Config utility functions
```

## Test Setup Architecture

**Global setup** (`tests/setup.ts`):
- Runs once before all tests (preloaded)
- Freezes `globalThis.TEST = { username: '_' }`
- Starts single server on port 3001
- All tests share this server instance

**Per-file setup** (`tests/helpers.ts`):
- `setupTestHooks()` configures beforeAll/beforeEach/afterAll
- Each test file can use unique port (via `portnumber()` hash function)
- `beforeEach` cleans up user files between tests
- Cleanup uses real API calls (no mocks)

**Port assignment strategy:**
```typescript
function portnumber(testFileName: string): number {
  return DEFAULT_PORT + (charCodeSum(testFileName) % 1000);
}
```

This allows parallel test execution without port conflicts.

## Common Patterns

### File Upload (Server Test)
```typescript
const formData = new FormData();
formData.append("file", new Blob(["content"]), "file.txt");
formData.append("path", "file.txt");

const res = await fetch(`${BASE_URL}/api/files`, {
  method: "POST",
  body: formData
});
```

### File Cleanup (Helper)
```typescript
async function cleanupUserFiles(port: number): Promise<void> {
  const res = await fetch(`http://localhost:${port}/api/files`);
  if (!res.ok) return;

  const files = await res.json();
  for (const file of files) {
    await fetch(`http://localhost:${port}/api/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file.ObjectName })
    });
  }
}
```

### DOM Event Simulation (E2E)
```typescript
// File input
const fileInput = document.getElementById('files') as HTMLInputElement;
const mockFile = new File(['data'], 'test.txt', { type: 'text/plain' });
Object.defineProperty(fileInput, 'files', { value: [mockFile] });
fileInput.dispatchEvent(new window.Event('change'));

// Button click
const button = document.getElementById('uploadBtn');
button.click();

// Form submission
const form = document.getElementById('form');
form.dispatchEvent(new window.Event('submit'));
```

### Async Wait (Use Sparingly)
```typescript
await Bun.sleep(1000); // Wait for async operations to complete
```

Use only when necessary for async operations that don't provide completion callbacks.

## What NOT to Do

❌ **Don't mock Bunny Storage API**
```typescript
// BAD
global.fetch = jest.fn().mockResolvedValue({ ok: true });
```

✅ **Do use real storage via .env config**

---

❌ **Don't add defensive error handling**
```typescript
// BAD
try {
  const res = await fetch(url);
  if (!res.ok) return; // Swallows error
} catch {
  return; // Hides failure
}
```

✅ **Do let errors propagate**
```typescript
// GOOD
const res = await fetch(url);
expect(res.ok).toBe(true); // Clear failure
```

---

❌ **Don't bypass DOM in e2e tests**
```typescript
// BAD - directly calling API in e2e test
await fetch(`${BASE_URL}/api/files`, { method: 'POST', body: formData });
```

✅ **Do interact through DOM**
```typescript
// GOOD - trigger form submission via DOM
form.dispatchEvent(new window.Event('submit'));
await Bun.sleep(500);
// Then verify result
```

---

❌ **Don't test implementation details**
```typescript
// BAD - testing internal function
test("buildFileTree() creates nested structure", () => { ... });
```

✅ **Do test observable behavior**
```typescript
// GOOD - testing rendered output
test("File tree displays nested folders", async () => {
  const treeEl = document.getElementById('tree');
  expect(treeEl.textContent).toContain('folder/subfolder/file.txt');
});
```

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/server.security.test.ts

# Run with filter
bun test --filter "path traversal"
```

## CI/CD Integration

Tests should run in CI with:
- Real Bunny Storage sandbox credentials in `.env`
- `NODE_ENV=test` or similar flag
- Parallel execution enabled (port hashing prevents conflicts)

No test mocks or stubs should be needed in CI environments.

## Troubleshooting

**Tests fail with "port already in use":**
- Check if another test file is using the same port
- Use `portnumber()` helper to generate unique ports per file

**happy-dom limitations:**
- Module scripts (`<script type="module">`) don't execute → replicate logic in test
- FileList API incomplete → use `Object.defineProperty()` workaround
- Some Web APIs missing → check happy-dom docs for compatibility

**Cleanup failures:**
- Tests may fail if previous test didn't clean up
- `beforeEach` should always call `cleanupUserFiles()`
- Check Bunny Storage sandbox quota

## Summary

- ✅ Real services, real server, real DOM
- ✅ Short-circuit auth, don't mock it
- ✅ Let failures surface organically
- ✅ E2E via DOM interactions, not API calls
- ✅ One mock exception: Shield flagged responses
- ❌ No defensive code in tests
- ❌ No mocks (except Shield)
- ❌ No headless browsers
