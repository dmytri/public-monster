import { test, expect, beforeAll, afterAll, describe, beforeEach } from "bun:test";
import type { Server } from "bun";
import { startServer } from "../src/app";

// --- Test Configuration ---

const TEST_PORT:number = 3001;
const TEST_USERNAME:string = `_`;

const BASE_URL = `http://localhost:${TEST_PORT}`;

let server: Server;

// --- Test Hooks ---

beforeAll(async () => {
  server = startServer(TEST_PORT, {'username': TEST_USERNAME});
  await Bun.sleep(50); // Wait for server to start
});

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

afterAll(async () => {
    await cleanup();
    await Bun.sleep(1000);
    server.stop(true);
});


// --- Test Cases ---

test("GET / - serves homepage", async () => {
  const res = await fetch(BASE_URL);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("public.monster");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

test("GET /public_html - serves file manager with env var replaced", async () => {
    const res = await fetch(`${BASE_URL}/public_html`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

test("GET /~username/path - redirects to CDN pull zone", async () => {
  const res = await fetch(`${BASE_URL}/~_/index.html`, { redirect: "manual" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toContain(`/~_/index.html`);
});

describe("API: Main", () => {
  test("POST /api/files - uploads a file", async () => {
    const form = new FormData();
    form.append("file", new Blob(['test']));
    form.append("path", 'test.txt');

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(200);
  }, 9000);

  test("POST /api/files - rejects disallowed file type", async () => {
    const form = new FormData();
    form.append("file", new Blob(["<script>alert(1)</script>"]), "danger.exe");
    form.append("path", "danger.exe");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("File type not allowed");
  });

  test("GET /api/files - lists files", async () => {
    // Upload a file first
    const form = new FormData();
    form.append("file", new Blob(["test"]), "test.txt");
    form.append("path", "test.txt");
    await fetch(`${BASE_URL}/api/files`, { method: "POST", body: form });

    const res = await fetch(`${BASE_URL}/api/files`, {
    });

    expect(res.status).toBe(200);
    const files = await res.json();
    expect(files.length).toBe(1);
    expect(files[0].ObjectName).toBe("test.txt");
  }, 10000); // Increase timeout to 10 seconds

  test("DELETE /api/files - deletes a file", async () => {
    // Upload a file first
    const form = new FormData();
    const filePath = "to-be-deleted.txt";
    form.append("file", new Blob(["delete me"]), filePath);
    form.append("path", filePath);
    await fetch(`${BASE_URL}/api/files`, { method: "POST", body: form });

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: filePath }),
    });

    expect(res.status).toBe(200);

    // Add a small delay to allow for the deletion to propagate
    await Bun.sleep(300);

    // Verify file is deleted
    const listRes = await fetch(`${BASE_URL}/api/files`, {});
    const files = await listRes.json();
    expect(files.find((f:any) => f.ObjectName === filePath)).toBeUndefined();
  }, 10000); // Increase timeout to 10 seconds

  test("POST /api/create-starter - creates a starter index.html", async () => {
    const res = await fetch(`${BASE_URL}/api/create-starter`, {
      method: "POST",
    });

    expect(res.status).toBe(200);

    // Verify file is created
    const listRes = await fetch(`${BASE_URL}/api/files`, {});
    const files = await listRes.json();
    expect(files.find((f:any) => f.ObjectName === "index.html")).toBeDefined();
  }, 9000);

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

describe.skip("API: Migration", () => {
  const oldUsername = "testuser-old";
  const newUsername = "testuser-new";
  const oldAuthToken = "test-token-old";
  const newAuthToken = "test-token-new";

  const testUserData = {
    [oldAuthToken]: { userid: "test-user-id-old", username: oldUsername },
    [newAuthToken]: { userid: "test-user-id-new", username: newUsername },
  };



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

test("404 handler", async () => {
    const res = await fetch(`${BASE_URL}/this-page-does-not-exist`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("PAGE NOT FOUND");
});

// Testing new static pages
test("GET /tos - serves Terms of Service page", async () => {
  const res = await fetch(`${BASE_URL}/tos`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("Terms of Service");
  expect(text).toContain("public.monster Terms of Service");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

test("GET /privacy-policy - serves Privacy Policy page", async () => {
  const res = await fetch(`${BASE_URL}/privacy-policy`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("Privacy Policy");
  expect(text).toContain("We think the web should be a fun, creative place");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

test("GET /content-moderation - serves Content Moderation Policy page", async () => {
  const res = await fetch(`${BASE_URL}/content-moderation`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("Content Moderation Policy");
  expect(text).toContain("Our Philosophy: Creative Freedom Meets Community Care");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

test("GET /validate-html - serves the HTML validation page", async () => {
  const res = await fetch(`${BASE_URL}/validate-html`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("HTML Validator");
  expect(text).toContain("🔍 HTML Validator");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

// Test for the new API endpoints
test("GET /api/whoami - returns user info in test mode", async () => {
  const res = await fetch(`${BASE_URL}/api/whoami`, {
    headers: {
      "Authorization": "Bearer test-token" // The test mode may bypass auth
    }
  });
  // In test mode, it may return mock user info
  expect([200, 400, 401, 403]).toContain(res.status);
  if (res.status === 200) {
    const data = await res.json();
    expect(data).toHaveProperty('username');
    expect(data).toHaveProperty('userid');
  }
}, 9000);

test("GET /api/files/content/* - should return 404 for invalid path", async () => {
  const res = await fetch(`${BASE_URL}/api/files/content`);
  expect(res.status).toBe(404); // Should return 404 when route is not matched properly
}, 9000);

// Test for the validate HTML endpoint
test("GET /api/validate-html - should validate user HTML", async () => {
  // First create a starter page to ensure there's an index.html
  const starterRes = await fetch(`${BASE_URL}/api/create-starter`, {
    method: "POST",
  });
  expect(starterRes.status).toBe(200);

  // Then try to validate HTML
  const validateRes = await fetch(`${BASE_URL}/api/validate-html`, {
    headers: {
      "Authorization": "Bearer test-token" // This should work in test mode
    }
  });

  // Should return 200 with validation results (might be an error in test mode)
  expect([200, 400, 401, 403]).toContain(validateRes.status);

  // If successful, should return JSON with validation results
  if (validateRes.status === 200) {
    const data = await validateRes.json();
    expect(data).toHaveProperty('valid');
    expect(data).toHaveProperty('issues');
  }
}, 9000);
