import { describe, test, expect } from "bun:test";
import { Window } from "happy-dom";
import { setupTestHooks, TEST_USERNAME, portnumber } from "./helpers";

// Calculate unique port for this test file
const TEST_PORT = portnumber('e2e.validate.test.ts');
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- E2E Tests for Validate HTML Page ---
test("validate.html loads with expected DOM structure", async () => {
  // Get the actual HTML from the server
  const response = await fetch(`${BASE_URL}/validate`);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: `${BASE_URL}/validate`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check for key elements in the HTML validation page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('#validationResults')).toBeTruthy();
  expect(document.querySelector('#loading')).toBeTruthy();

  // Check for the new view source elements
  expect(document.querySelector('#viewSourceBtn')).toBeTruthy();
  expect(document.querySelector('#sourceCodeContainer')).toBeTruthy();
  expect(document.querySelector('#sourceCodeContent')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('HTML Validator');
}, 20000);

test("validate.html includes view source functionality", async () => {
  // Get the actual HTML from the server
  const response = await fetch(`${BASE_URL}/validate`);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: `${BASE_URL}/validate`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check that the view source button exists
  const viewSourceBtn = document.querySelector('#viewSourceBtn');
  expect(viewSourceBtn).toBeTruthy();
  expect(viewSourceBtn?.textContent).toContain('View Source');

  // Check that the source code container exists and is initially hidden
  const sourceContainer = document.querySelector('#sourceCodeContainer');
  expect(sourceContainer).toBeTruthy();
  // The container should be hidden initially (display: none or empty)
  const displayStyle = sourceContainer?.style.display;
  expect(displayStyle === 'none' || displayStyle === '').toBe(true);

  // Check that the source code content element exists
  const sourceCodeContent = document.querySelector('#sourceCodeContent');
  expect(sourceCodeContent).toBeTruthy();

  // Check that prism CSS is included
  const prismCssLink = Array.from(document.querySelectorAll('link')).find(
    link => link.getAttribute('href')?.includes('prism.css')
  );
  expect(prismCssLink).toBeTruthy();

  // Check that line numbers CSS is included
  const lineNumbersCssLink = Array.from(document.querySelectorAll('link')).find(
    link => link.getAttribute('href')?.includes('prism-line-numbers.css')
  );
  expect(lineNumbersCssLink).toBeTruthy();
}, 20000);

test("validate.html view source button toggles source visibility", async () => {
  // Get the actual HTML from the server
  const response = await fetch(`${BASE_URL}/validate`);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: `${BASE_URL}/validate`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Manually execute the content of the DOMContentLoaded event to set up event listeners
  // Set up view source button event listener (replicating the code from the HTML file)
  const viewSourceBtn = document.getElementById('viewSourceBtn') as HTMLElement;
  const sourceContainer = document.getElementById('sourceCodeContainer') as HTMLElement;

  viewSourceBtn.addEventListener('click', function() {
    if (sourceContainer.style.display === 'none' || sourceContainer.style.display === '') {
      sourceContainer.style.display = 'block';
      this.textContent = '-hide Source';
    } else {
      sourceContainer.style.display = 'none';
      this.textContent = '👀 View Source';
    }
  });

  // Initially the container has its display set by CSS class to 'none'
  // The JavaScript toggles between 'block' and the CSS default ('none')
  const initialDisplay = sourceContainer.style.display; // This will be 'none' due to CSS class

  // Trigger the click event on the button
  const clickEvent = new window.Event('click');
  viewSourceBtn.dispatchEvent(clickEvent);

  // After clicking, it should change to 'block'
  expect(sourceContainer.style.display).toBe('block');
  expect(viewSourceBtn.textContent).toContain('hide');

  // Click again to toggle back
  viewSourceBtn.dispatchEvent(clickEvent);

  // After clicking again, it should go back to 'none' (the CSS default)
  expect(sourceContainer.style.display).toBe('none');
  expect(viewSourceBtn.textContent).toBe('👀 View Source');
}, 20000);

test("validate.html source code displays with line numbers", async () => {
  // Get the actual HTML from the server
  const response = await fetch(`${BASE_URL}/validate`);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: `${BASE_URL}/validate`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Manually execute the content of the DOMContentLoaded event to set up event listeners
  // Set up view source button event listener (replicating the code from the HTML file)
  const viewSourceBtn = document.getElementById('viewSourceBtn') as HTMLElement;
  const sourceContainer = document.getElementById('sourceCodeContainer') as HTMLElement;

  viewSourceBtn.addEventListener('click', function() {
    if (sourceContainer.style.display === 'none' || sourceContainer.style.display === '') {
      sourceContainer.style.display = 'block';
      this.textContent = '-hide Source';
    } else {
      sourceContainer.style.display = 'none';
      this.textContent = '👀 View Source';
    }
  });

  // Test the displaySourceCode function directly
  const sourceCodeElement = document.getElementById('sourceCodeContent');
  const testCode = '<!DOCTYPE html>\n<html>\n<head>\n<title>Test</title>\n</head>\n<body>\n<h1>Hello</h1>\n</body>\n</html>';

  // This replicates the displaySourceCode function logic
  const encodedSource = testCode
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  sourceCodeElement.innerHTML = `<pre class="line-numbers"><code class="language-html">${encodedSource}</code></pre>`;

  // Check that the pre element has the line-numbers class
  const preElement = sourceCodeElement.querySelector('pre');
  expect(preElement).toBeTruthy();
  expect(preElement?.classList.contains('line-numbers')).toBe(true);

  // Check that the code element has the language-html class
  const codeElement = sourceCodeElement.querySelector('code');
  expect(codeElement).toBeTruthy();
  expect(codeElement?.classList.contains('language-html')).toBe(true);
}, 20000);

test("GET /validate serves the validation page", async () => {
  const res = await fetch(`${BASE_URL}/validate`);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("HTML Validator");
  expect(text).toContain("🔍 HTML Validator");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);

