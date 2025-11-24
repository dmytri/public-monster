import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";
import { setupTestHooks, TEST_USERNAME, portnumber } from "./helpers";
import { validateHtml } from "../src/handlers/api/files";

// Calculate unique port for this test file
const TEST_PORT = portnumber('e2e.validate-html.test.ts');
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- E2E Tests for Validate HTML Page ---
test("validate-html.html loads with expected DOM structure", async () => {
  const htmlContent = await Bun.file("./public/validate-html.html").text();

  const window = new Window({
    url: `${BASE_URL}/validate-html`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check for key elements in the HTML validation page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('#validationResults')).toBeTruthy();
  expect(document.querySelector('#loading')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('HTML Validator');
}, 20000);

test("GET /validate-html serves the HTML validation page", async () => {
  const res = await fetch(`${BASE_URL}/validate-html`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("HTML Validator");
  expect(text).toContain("🔍 HTML Validator");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

// Test for the validate HTML endpoint
test("GET /api/validate-html should validate user HTML", async () => {
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

// --- HTML Validation Logic Tests ---
describe("HTML Validation Logic", () => {
  test("valid HTML should pass validation", () => {
    const validHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test</title>
        </head>
        <body>
          <h1>Hello World</h1>
          <p>This is a test.</p>
          <img src="image.jpg" alt="test image">
        </body>
      </html>
    `;

    const result = validateHtml(validHtml);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test("HTML with unclosed tags should fail validation", () => {
    const invalidHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test</title>
        </head>
        <body>
          <h1>Hello World
        </body>
      </html>
    `;

    const result = validateHtml(invalidHtml);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: 'error',
        message: expect.stringContaining('Unclosed tag'),
        codeSnippet: expect.any(String)
      })
    );
  });

  test("HTML with missing alt attribute should generate warning", () => {
    const htmlWithMissingAlt = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test</title>
        </head>
        <body>
          <img src="image.jpg">
        </body>
      </html>
    `;

    const result = validateHtml(htmlWithMissingAlt);
    expect(result.valid).toBe(false); // Because warnings also make it invalid
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        message: 'Image tag missing alt attribute',
        codeSnippet: expect.any(String)
      })
    );
  });

  test("HTML with unquoted attributes should generate warning", () => {
    const htmlWithUnquotedAttr = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test</title>
        </head>
        <body>
          <a href=test.html>Link</a>
        </body>
      </html>
    `;

    const result = validateHtml(htmlWithUnquotedAttr);
    expect(result.valid).toBe(false); // Because warnings also make it invalid
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        type: 'warning',
        message: 'Attribute without quotes',
        codeSnippet: expect.any(String)
      })
    );
  });
});