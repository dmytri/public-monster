import { test, expect, beforeAll, afterAll, describe, beforeEach } from "bun:test";
import type { Server } from "bun";
import { startServer } from "../src/app";

// --- Test Configuration ---

const TEST_PORT = 3001;
const BASE_URL = `http://localhost:${TEST_PORT}`;
// THIS IS A TEST USER'S TOKEN, NOT A PRODUCTION TOKEN
let authToken = process.env.TEST_AUTH_TOKEN || "test-token";
let username = process.env.TEST_USERNAME || "testuser";



let server: Server;

// --- Test Hooks ---

beforeAll(async () => {
  const testUserData = {
    "test-token-old": { userid: "test-user-id-old", username: "testuser-old" },
    "test-token-new": { userid: "test-user-id-new", username: "testuser-new" },
  };

  server = startServer({
    ...process.env,
    TEST_AUTH_TOKEN: authToken,
    TEST_USERNAME: username,
    TEST_USER_DATA: JSON.stringify(testUserData),
  }, TEST_PORT);
  await Bun.sleep(50); // Wait for server to start
});



// --- Helper Functions ---

async function cleanup() {
    if (!authToken) return;
    const res = await fetch(`${BASE_URL}/api/files`, {
        headers: { Authorization: `Bearer ${authToken}` },
    });
    if (!res.ok) return;
    const files = await res.json();
    for (const file of files) {
        await fetch(`${BASE_URL}/api/files`, {
            method: "DELETE",
            headers: {
                Authorization: `Bearer ${authToken}`,
                "Content-Type": "application/json",
            },
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
});

test("GET /public_html - serves file manager with env var replaced", async () => {
    const res = await fetch(`${BASE_URL}/public_html`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
});

test("GET /~username/path - redirects to CDN pull zone", async () => {
  if (!username) return;
  const res = await fetch(`${BASE_URL}/~${username}/index.html`, { redirect: "manual" });
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toContain(`/~${username}/index.html`);
});

describe("API: Main", () => {
  test("POST /api/files - fails without auth", async () => {
    const form = new FormData();
    form.append("file", new Blob(["test"]), "test.txt");
    form.append("path", "test.txt");
    const res = await fetch(`${BASE_URL}/api/files`, { method: "POST", body: form });
    expect(res.status).toBe(401);
  });

  test("POST /api/files - uploads a file with auth", async () => {
    if (!authToken) return;
    const form = new FormData();
    const fileContent = "hello world";
    const filePath = "test.txt";
    form.append("file", new Blob([fileContent]), filePath);
    form.append("path", filePath);

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });

    expect(res.status).toBe(200);
  }, 10000);

  test("POST /api/files - rejects disallowed file type", async () => {
    if (!authToken) return;
    const form = new FormData();
    form.append("file", new Blob(["<script>alert(1)</script>"]), "danger.exe");
    form.append("path", "danger.exe");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
      body: form,
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("File type not allowed");
  });

  test("GET /api/files - lists files for authenticated user", async () => {
    if (!authToken) return;
    // Upload a file first
    const form = new FormData();
    form.append("file", new Blob(["test"]), "test.txt");
    form.append("path", "test.txt");
    await fetch(`${BASE_URL}/api/files`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` }, body: form });

    const res = await fetch(`${BASE_URL}/api/files`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(res.status).toBe(200);
    const files = await res.json();
    expect(files.length).toBe(1);
    expect(files[0].ObjectName).toBe("test.txt");
  }, 10000); // Increase timeout to 10 seconds

  test("DELETE /api/files - deletes a file", async () => {
    if (!authToken) return;
    // Upload a file first
    const form = new FormData();
    const filePath = "to-be-deleted.txt";
    form.append("file", new Blob(["delete me"]), filePath);
    form.append("path", filePath);
    await fetch(`${BASE_URL}/api/files`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` }, body: form });

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: filePath }),
    });

    expect(res.status).toBe(200);

    // Add a small delay to allow for the deletion to propagate
    await Bun.sleep(100);

    // Verify file is deleted
    const listRes = await fetch(`${BASE_URL}/api/files`, { headers: { Authorization: `Bearer ${authToken}` } });
    const files = await listRes.json();
    expect(files.find((f:any) => f.ObjectName === filePath)).toBeUndefined();
  }, 10000); // Increase timeout to 10 seconds

  test("POST /api/create-starter - creates a starter index.html", async () => {
    if (!authToken) return;
    const res = await fetch(`${BASE_URL}/api/create-starter`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(res.status).toBe(200);

    // Verify file is created
    const listRes = await fetch(`${BASE_URL}/api/files`, { headers: { Authorization: `Bearer ${authToken}` } });
    const files = await listRes.json();
    expect(files.find((f:any) => f.ObjectName === "index.html")).toBeDefined();
  });

  test("GET /api/files/zip - returns a zip file", async () => {
    if (!authToken) return;
    // Upload a file first
    const form = new FormData();
    form.append("file", new Blob(["test"]), "test.txt");
    form.append("path", "test.txt");
    await fetch(`${BASE_URL}/api/files`, { method: "POST", headers: { Authorization: `Bearer ${authToken}` }, body: form });

    const res = await fetch(`${BASE_URL}/api/files/zip`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    const blob = await res.blob();
    expect(blob.size).toBeGreaterThan(100);
  });
});

describe("API: Migration", () => {
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
      headers: { Authorization: `Bearer ${oldAuthToken}` },
      body: form,
    });

    // 2. Prepare migration as the old user
    const prepareRes = await fetch(`${BASE_URL}/api/prepare-migration`, {
      method: "POST",
      headers: { Authorization: `Bearer ${oldAuthToken}` },
    });
    expect(prepareRes.status).toBe(200);
    const { token: migrationToken } = await prepareRes.json();
    expect(migrationToken).toBeString();

    // 3. Perform migration as the new user
    const migrateRes = await fetch(`${BASE_URL}/api/migrate-username`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${newAuthToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ oldUsername, token: migrationToken }),
    });
    expect(migrateRes.status).toBe(200);

    // 4. Verify file was moved to new user's directory
    const newFilesRes = await fetch(`${BASE_URL}/api/files`, {
      headers: { Authorization: `Bearer ${newAuthToken}` },
    });
    const newFiles = await newFilesRes.json();
    expect(newFiles.find((f: any) => f.ObjectName === filePath)).toBeDefined();

    // 5. Verify file was removed from old user's directory
    const oldFilesRes = await fetch(`${BASE_URL}/api/files`, {
      headers: { Authorization: `Bearer ${oldAuthToken}` },
    });
    const oldFiles = await oldFilesRes.json();
    expect(oldFiles.find((f: any) => f.ObjectName === filePath)).toBeUndefined();
  }, 20000); // Increase timeout to 20 seconds
});

test("404 handler", async () => {
    const res = await fetch(`${BASE_URL}/this-page-does-not-exist`);
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("PAGE NOT FOUND");
});