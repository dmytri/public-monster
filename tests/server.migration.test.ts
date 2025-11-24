import { test, expect, describe, beforeEach } from "bun:test";
import { setupTestHooks, TEST_USERNAME, portnumber } from "./helpers";

// Calculate unique port for this test file
const TEST_PORT = portnumber('server.migration.test.ts');
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- Helper Functions ---
async function cleanup() {
    const res = await fetch(`${BASE_URL}/api/files`)
    if (!res.ok) return;
    const files = await res.json();
    for (const file of files) {
      await fetch(`${BASE_URL}/api/files`, {
          method: "DELETE",
          body: JSON.stringify({ path: file.ObjectName }),
      });
    }
}

beforeEach(async () => {
    await cleanup();
});

// --- Migration API Tests ---
describe("API: Migration", () => {
  const oldUsername = "testuser-old";
  const newUsername = "testuser-new";
  const oldAuthToken = "test-token-old";
  const newAuthToken = "test-token-new";

  test("handles full migration flow", async () => {
    // 1. Populate old user's directory
    const form = new FormData();
    const fileContent = "migration test";
    const filePath = "test.txt";
    form.append("file", new Blob([fileContent]), filePath);
    form.append("path", filePath);

    await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    // 2. Prepare migration as the old user
    const prepareRes = await fetch(`${BASE_URL}/api/prepare-migration`)
    expect(prepareRes.status).toBe(200);

    // 3. Perform migration as the new user
    const migrateRes = await fetch(`${BASE_URL}/api/migrate-username`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ old: "=new" }),
    });
    expect(migrateRes.status).toBe(200);
  }, 20000);
});