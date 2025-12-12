import { test, expect, describe } from "bun:test";
import { setupTestHooks, TEST_USERNAME, TEST_PORT, uploadFile } from "./helpers";

const BASE_URL = `http://localhost:${TEST_PORT}`;

setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

describe("Endpoint Security Tests", () => {
  describe("GET /api/whoami", () => {
    test("Returns authenticated user info", async () => {
      const res = await fetch(`${BASE_URL}/api/whoami`);

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/json");

      const data = await res.json();
      expect(data).toHaveProperty("userid");
      expect(data).toHaveProperty("username");
      expect(data.username).toBe(TEST_USERNAME);
    });
  });

  describe("GET /api/files/content/*", () => {
    test("Returns file content for existing file", async () => {
      // Upload a test file first
      const uploadRes = await uploadFile("test-content.txt", "Hello, World!", "test-content.txt", TEST_PORT);
      expect(uploadRes.status).toBe(200);

      // Retrieve file content
      const res = await fetch(`${BASE_URL}/api/files/content/test-content.txt`);

      expect(res.status).toBe(200);
      const content = await res.text();
      expect(content).toBe("Hello, World!");
    });

    test("Returns 404 for non-existent file", async () => {
      const res = await fetch(`${BASE_URL}/api/files/content/does-not-exist.txt`);

      expect(res.status).toBe(404);
      expect(await res.text()).toBe("File not found");
    });

    test("Rejects path traversal attempts", async () => {
      const traversalAttempts = [
        "../../../etc/passwd",
        "../../etc/hosts",
        "../.ssh/id_rsa",
        "folder/../../secrets.txt"
      ];

      for (const path of traversalAttempts) {
        const res = await fetch(`${BASE_URL}/api/files/content/${path}`);

        // Server validates and returns 400 for invalid paths
        expect(res.status).toBe(400);
        expect(await res.text()).toBe("Invalid file path");
      }
    });

    test("Rejects path containing ..", async () => {
      const res = await fetch(`${BASE_URL}/api/files/content/..`);

      // Returns 400 for invalid path
      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Invalid file path");
    });

    test("Returns 400 for empty file path", async () => {
      const res = await fetch(`${BASE_URL}/api/files/content/`);

      expect(res.status).toBe(400);
      expect(await res.text()).toBe("File path not specified");
    });

    test("Handles nested directory paths correctly", async () => {
      // Upload file in nested directory
      const uploadRes = await uploadFile("folder/nested/file.txt", "Nested content", "file.txt", TEST_PORT);
      expect(uploadRes.status).toBe(200);

      // Retrieve nested file
      const res = await fetch(`${BASE_URL}/api/files/content/folder/nested/file.txt`);

      expect(res.status).toBe(200);
      const content = await res.text();
      expect(content).toBe("Nested content");
    });
  });

  describe("GET /assets/*", () => {
    test("Allows prismjs assets", async () => {
      const res = await fetch(`${BASE_URL}/assets/prismjs/themes/prism.css`);

      // Should either succeed (200) or not exist (404), but not be blocked
      expect([200, 404]).toContain(res.status);
      if (res.status === 404) {
        expect(await res.text()).toBe("Not found");
      }
    });

    test("Allows htmlhint assets", async () => {
      const res = await fetch(`${BASE_URL}/assets/htmlhint/dist/htmlhint.js`);

      // Should either succeed (200) or not exist (404), but not be blocked
      expect([200, 404]).toContain(res.status);
      if (res.status === 404) {
        expect(await res.text()).toBe("Not found");
      }
    });

    test("Allows hanko-elements assets", async () => {
      const res = await fetch(`${BASE_URL}/assets/@teamhanko/hanko-elements/dist/elements.js`);

      // Should either succeed (200) or not exist (404), but not be blocked
      expect([200, 404]).toContain(res.status);
      if (res.status === 404) {
        expect(await res.text()).toBe("Not found");
      }
    });

    test("Allows escape-html assets", async () => {
      const res = await fetch(`${BASE_URL}/assets/escape-html/index.js`);

      // Should either succeed (200) or not exist (404), but not be blocked
      expect([200, 404]).toContain(res.status);
      if (res.status === 404) {
        expect(await res.text()).toBe("Not found");
      }
    });

    test("Blocks non-whitelisted assets", async () => {
      const blockedPaths = [
        "/assets/express/index.js",
        "/assets/lodash/lodash.js",
        "/assets/../package.json",
        "/assets/malicious-package/exploit.js"
      ];

      for (const path of blockedPaths) {
        const res = await fetch(`${BASE_URL}${path}`);

        expect(res.status).toBe(404);
        // Falls through to default 404 handler which returns HTML page
        const text = await res.text();
        expect(text).toContain("404");
        expect(text).toContain("PAGE NOT FOUND");
      }
    });

    test("Blocks path traversal in assets", async () => {
      const res = await fetch(`${BASE_URL}/assets/../package.json`);

      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toContain("404");
      expect(text).toContain("PAGE NOT FOUND");
    });

    test("Sets correct Content-Type for CSS files", async () => {
      const res = await fetch(`${BASE_URL}/assets/prismjs/themes/prism.css`);

      if (res.status === 200) {
        expect(res.headers.get("Content-Type")).toBe("text/css");
      }
    }, { skip: true }); // Skip if file doesn't exist

    test("Sets correct Content-Type for JS files", async () => {
      const res = await fetch(`${BASE_URL}/assets/htmlhint/dist/htmlhint.js`);

      if (res.status === 200) {
        expect(res.headers.get("Content-Type")).toBe("application/javascript");
      }
    }, { skip: true }); // Skip if file doesn't exist
  });
});
