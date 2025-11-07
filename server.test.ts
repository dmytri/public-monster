import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawn } from "bun";
import { mkdir, writeFile } from "node:fs/promises";

let server: any;
const BASE = "http://localhost:3000";

beforeAll(async () => {
  server = spawn([process.execPath, "server.ts"], { env: { ...process.env, PUBLIC_DIR: "/tmp/test_public" } });
  await Bun.sleep(1000);
  await mkdir("/tmp/test_public/testuser", { recursive: true });
  await writeFile("/tmp/test_public/testuser/index.html", "<h1>Test</h1>");
  await writeFile("/tmp/test_public/testuser/style.css", "body{color:red}");
});

afterAll(() => server.kill());

test("serves homepage", async () => {
  const res = await fetch(BASE);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("public.monster");
});

test("redirects /~user to /~user/", async () => {
  const res = await fetch(`${BASE}/~testuser`, { redirect: "manual" });
  expect(res.status).toBe(301);
  expect(res.headers.get("location")).toBe("/~testuser/");
});

test("serves user files", async () => {
  const res = await fetch(`${BASE}/~testuser/index.html`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("Test");
});

test("serves CSS with correct content-type", async () => {
  const res = await fetch(`${BASE}/~testuser/style.css`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/css");
});

test("returns 404 for missing files", async () => {
  const res = await fetch(`${BASE}/~testuser/missing.html`);
  expect(res.status).toBe(404);
});

test("uploads file without auth (demo mode)", async () => {
  const form = new FormData();
  form.append("file", new Blob(["test content"]), "test.txt");
  form.append("path", "uploaded.txt");
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  expect(res.status).toBe(200);
});

test("uploads nested file", async () => {
  const form = new FormData();
  form.append("file", new Blob(["nested"]), "nested.html");
  form.append("path", "sub/dir/nested.html");
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  expect(res.status).toBe(200);
});
