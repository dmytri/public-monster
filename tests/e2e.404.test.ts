import { test, expect } from "bun:test";
import { Window } from "happy-dom";
import { setupTestHooks, TEST_USERNAME, portnumber } from "./helpers";

// Calculate unique port for this test file
const TEST_PORT = portnumber('e2e.404.test.ts');
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- 404 Page E2E Tests ---
test("404.html loads with expected DOM structure", async () => {
  const htmlContent = await Bun.file("./public/404.html").text();

  const window = new Window({
    url: `${BASE_URL}/404`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check for key elements in the 404 page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('#suggestions')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('404');
}, 20000);

test("404 handler returns expected content", async () => {
  const res = await fetch(`${BASE_URL}/this-page-does-not-exist`);
  expect(res.status).toBe(404);
  const text = await res.text();
  expect(text).toContain("PAGE NOT FOUND");
});