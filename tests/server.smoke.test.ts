import { test, expect, describe } from "bun:test";
import { setupTestHooks, TEST_USERNAME, TEST_PORT } from "./helpers";

const BASE_URL = `http://localhost:${TEST_PORT}`;

// Use the helpers for server setup
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- Server Smoke Tests ---
describe("Server Smoke Tests", () => {
  test("Server starts and responds to health check", async () => {
    const res = await fetch(BASE_URL);
    expect(res.status).toBe(200);
  }, 10000);

  test("File upload works", async () => {
    const form = new FormData();
    form.append("file", new Blob(['test content']));
    form.append("path", 'smoke-test.txt');

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(200);
  }, 10000);

  test("File listing works", async () => {
    // Upload a file first
    const form = new FormData();
    form.append("file", new Blob(["test"]), "list-test.txt");
    form.append("path", "list-test.txt");
    await fetch(`${BASE_URL}/api/files`, { method: "POST", body: form });

    const res = await fetch(`${BASE_URL}/api/files`, {});

    expect(res.status).toBe(200);
    const files = await res.json();
    expect(Array.isArray(files)).toBe(true);
    expect(files.some((f: any) => f.ObjectName === "list-test.txt")).toBe(true);
  }, 10000);

  test("File deletion works", async () => {
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

    // Verify file is deleted
    const listRes = await fetch(`${BASE_URL}/api/files`, {});
    const files = await listRes.json();
    expect(files.find((f: any) => f.ObjectName === filePath)).toBeUndefined();
  }, 10000);
});