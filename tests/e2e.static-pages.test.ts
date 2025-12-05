import { test, expect } from "bun:test";
import { Window } from "happy-dom";
import { setupTestHooks, TEST_USERNAME, portnumber } from "./helpers";

// Calculate unique port for this test file
const TEST_PORT = portnumber('e2e.static-pages.test.ts');
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- Static Pages E2E Tests ---

test("about.html loads with expected DOM structure", async () => {
  // Get the actual HTML from the server
  const response = await fetch(`${BASE_URL}/about`);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: `${BASE_URL}/about`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check for key elements in the about page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('.container')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('What is public.monster');
}, 20000);

test("faq.html loads with expected DOM structure", async () => {
  // Get the actual HTML from the server
  const response = await fetch(`${BASE_URL}/faq`);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: `${BASE_URL}/faq`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check for key elements in the faq page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('.container')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('FAQ');
}, 20000);

test("profile.html loads with expected DOM structure", async () => {
  // Get the actual HTML from the server
  const response = await fetch(`${BASE_URL}/profile`);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: `${BASE_URL}/profile`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check for key elements in the profile page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('#username')).toBeTruthy();
  expect(document.querySelector('#profile-container')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('Profile');
}, 20000);

// Testing static page serving
test("GET /tos - serves Terms of Service page", async () => {
  const res = await fetch(`${BASE_URL}/tos`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("Terms of Service");
  expect(text).toContain("<h1><span class=\"emoji\">🌐</span> Terms of Service <span class=\"emoji\">🌐</span></h1>");
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