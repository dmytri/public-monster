import { test, expect, describe } from "bun:test";
import { setupTestHooks, TEST_USERNAME, TEST_PORT } from "./helpers";

// Calculate unique port for this test file
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- Security Tests ---
describe("Security: Path Traversal", () => {
  test("POST /api/files - rejects path traversal attempts", async () => {
    // Test various path traversal attempts
    const traversalAttempts = [
      "../../../etc/passwd",
      "..\\..\\windows\\system32",
      "folder/../../etc/hosts",
      "folder\\..\\..\\windows\\system32",
      "/etc/passwd",
      "\\windows\\system32",
      `../~${TEST_USERNAME}2`,
      `/../~${TEST_USERNAME}2`
    ];

    for (const traversalPath of traversalAttempts) {
      const form = new FormData();
      form.append("file", new Blob(["test content"])); // Use a valid file name
      form.append("path", [traversalPath, 'valid.txt'].join('/')); // But test the traversal path
      const res = await fetch(`${BASE_URL}/api/files`, {
        method: "POST",
        body: form,
      });

      // Should reject path traversal attempts
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Invalid file path");
    }
  });

  test("DELETE /api/files - rejects path traversal attempts", async () => {
    // Test various path traversal attempts in DELETE requests
    const traversalAttempts = [
      "../../../etc/passwd",
      "..\\..\\windows\\system32",
      "folder/../../etc/hosts",
      "folder\\..\\..\\windows\\system32",
      "/etc/passwd",
      "\\windows\\system32",
      `../~${TEST_USERNAME}2`,
      `/../~${TEST_USERNAME}2`
    ];

    for (const traversalPath of traversalAttempts) {
      const res = await fetch(`${BASE_URL}/api/files`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: traversalPath }),
      });

      // Should reject path traversal attempts
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Invalid file path");
    }
  });
});