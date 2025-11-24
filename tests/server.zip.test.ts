import { test, expect, describe } from "bun:test";
import { setupTestHooks, TEST_USERNAME, TEST_PORT } from "./helpers";

const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- ZIP API Tests ---
test("GET /api/files/zip - returns a zip file", async () => {
  // Upload a file first
  const form = new FormData();
  form.append("file", new Blob(["test"]), "test.txt");
  form.append("path", "test.txt");
  await fetch(`${BASE_URL}/api/files`, { method: "POST", body: form });

  const res = await fetch(`${BASE_URL}/api/files/zip`, {
  });

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/zip");
  const blob = await res.blob();
  expect(blob.size).toBeGreaterThan(100);
}, 9000);