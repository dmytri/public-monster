import { describe, test, expect } from "bun:test";
import { validateHtml } from "../src/handlers/api/files"; // Adjust import path as needed

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