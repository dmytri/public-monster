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

describe("Security: Extension Whitelist", () => {
  test("POST /api/files - rejects disallowed file extensions", async () => {
    const disallowedExtensions = [
      ".exe",
      ".sh",
      ".bat",
      ".cmd",
      ".com",
      ".dll",
      ".so",
      ".dylib",
      ".app",
      ".dmg",
      ".pkg",
      ".deb",
      ".rpm"
    ];

    for (const ext of disallowedExtensions) {
      const form = new FormData();
      form.append("file", new Blob(["malicious content"]), `malware${ext}`);
      form.append("path", `malware${ext}`);

      const res = await fetch(`${BASE_URL}/api/files`, {
        method: "POST",
        body: form,
      });

      // Should reject disallowed file types
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("File type not allowed");
    }
  });

  test("POST /api/files - allows whitelisted file extensions", async () => {
    const allowedExtensions = [
      ".html",
      ".css",
      ".js",
      ".png",
      ".jpg",
      ".txt",
      ".json",
      ".pdf",
      ".mp4",
      ".svg"
    ];

    for (const ext of allowedExtensions) {
      const form = new FormData();
      form.append("file", new Blob(["test content"]), `test${ext}`);
      form.append("path", `test${ext}`);

      const res = await fetch(`${BASE_URL}/api/files`, {
        method: "POST",
        body: form,
      });

      // Should allow whitelisted file types
      expect(res.status).toBe(200);
    }
  });

  test("POST /api/files - rejects files without extension", async () => {
    const form = new FormData();
    form.append("file", new Blob(["test content"]), "noextension");
    form.append("path", "noextension");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    // Should reject files without extension
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("File type not allowed");
  });

  test("POST /api/files - handles case insensitive extensions", async () => {
    const form = new FormData();
    form.append("file", new Blob(["test content"]), "test.HTML");
    form.append("path", "test.HTML");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    // Should allow uppercase extensions
    expect(res.status).toBe(200);
  });
});

describe("Security: File Size Limits", () => {
  test("POST /api/files - rejects files exceeding 5MB limit", async () => {
    const size = 6 * 1024 * 1024; // 6MB
    const largeFile = new Blob([new Uint8Array(size)]);

    const form = new FormData();
    form.append("file", largeFile, "large.txt");
    form.append("path", "large.txt");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    // Should reject files over 5MB
    expect(res.status).toBe(413);
    expect(await res.text()).toBe("File too large (max 5MB)");
  });

  test("POST /api/files - accepts files at exactly 5MB", async () => {
    const size = 5 * 1024 * 1024; // Exactly 5MB
    const largeFile = new Blob([new Uint8Array(size)]);

    const form = new FormData();
    form.append("file", largeFile, "exactly5mb.txt");
    form.append("path", "exactly5mb.txt");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    // Should accept files at the limit
    expect(res.status).toBe(200);
  }, 30000);

  test("POST /api/files - accepts files under 5MB", async () => {
    const size = 1 * 1024 * 1024; // 1MB
    const normalFile = new Blob([new Uint8Array(size)]);

    const form = new FormData();
    form.append("file", normalFile, "normal.txt");
    form.append("path", "normal.txt");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    // Should accept normal sized files
    expect(res.status).toBe(200);
  });
});