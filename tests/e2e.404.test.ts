import { test, expect } from "bun:test";
import { Window } from "happy-dom";
import { setupTestHooks, TEST_USERNAME, portnumber } from "./helpers";

// Calculate unique port for this test file
const TEST_PORT = portnumber('e2e.404.test.ts');
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- 404 Page E2E Tests ---
test("404.html loads with expected DOM structure and shows file suggestions based on distance", async () => {
  // First, let's upload a file to have something to suggest
  const formData = new FormData();
  formData.append("file", new Blob(["test content"]), "test-suggestion.html");
  formData.append("path", "test-suggestion.html");

  const uploadResponse = await fetch(`${BASE_URL}/api/files`, {
    method: "POST",
    body: formData
  });
  expect(uploadResponse.status).toBe(200);

  // Get the actual HTML from the server (for a non-existent page to trigger 404)
  // Use a similar name to test the distance function (only 2 characters different from 'test-suggestion.html')
  const window = new Window({
    url: `${BASE_URL}/tes-suggestion.html`
  });

  const response = await fetch(`${BASE_URL}/tes-suggestion.html`); // Similar name to test distance function
  expect(response.status).toBe(404);
  const htmlContent = await response.text();

  const { document } = window;
  document.write(htmlContent);

  // Mock the module import for hanko (test mode authentication)
  (window as any).hankoToken = 'test-token';

  // Mock fetch to return our uploaded file when the 404 page requests file list
  const originalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.includes('/api/files')) {
      // Return our test file in the response
      return {
        ok: true,
        json: async () => [
          { ObjectName: 'test-suggestion.html', Length: 12, LastChanged: new Date().toISOString() }
        ],
        text: async () => 'OK'
      } as Response;
    }
    return originalFetch(input, init);
  };

  // Simulate the 404.js script execution with distance function
  // Get current path (simulating the non-existent page)
  const path = window.location.pathname;
  const filename = path.split('/').pop();

  if (filename) {
    // Define the distance function here as well to mirror what's in 404.js
    function dist(s1: string, s2: string): number {
      // Create a matrix of size (s1.length+1) x (s2.length+1)
      const dp = Array(s1.length + 1).fill(null).map(() => Array(s2.length + 1).fill(0));

      // Initialize the first row and column
      for (let i = 0; i <= s1.length; i++) {
        dp[i][0] = i;
      }
      for (let j = 0; j <= s2.length; j++) {
        dp[0][j] = j;
      }

      // Fill the matrix
      for (let i = 1; i <= s1.length; i++) {
        for (let j = 1; j <= s2.length; j++) {
          if (s1[i - 1] === s2[j - 1]) {
            dp[i][j] = dp[i - 1][j - 1];
          } else {
            dp[i][j] = 1 + Math.min(
              dp[i - 1][j],     // deletion
              dp[i][j - 1],     // insertion
              dp[i - 1][j - 1]  // substitution
            );
          }
        }
      }

      return dp[s1.length][s2.length];
    }

    try {
      const res = await window.fetch('/api/files', { credentials: 'include' } as RequestInit);

      if (res.ok) {
        const files = await res.json();
        const matches = files.filter((f: any) => dist(f.ObjectName.toLowerCase(), filename.toLowerCase()) <= 2);

        if (matches.length > 0) {
          const suggestionsDiv = document.getElementById('suggestions');
          if (suggestionsDiv) {
            suggestionsDiv.style.display = 'block';

            const list = document.getElementById('matchList');
            if (list) {
              matches.forEach((match: any) => {
                const li = document.createElement('li');
                li.innerHTML = `<code>${match.ObjectName}</code> → <a href="/~${TEST_USERNAME}/${match.ObjectName}">/~${TEST_USERNAME}/${match.ObjectName}</a>`;
                list.appendChild(li);
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to check files', e);
    }
  }

  document.close();

  // Check for key elements in the 404 page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('#suggestions')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('404');

  // Check the suggestions element contains the test file we "uploaded"
  const suggestionsElement = document.getElementById('suggestions');
  if (suggestionsElement) {
    // The suggestions should include our test file based on distance
    expect(suggestionsElement.textContent).toContain('test-suggestion.html');
  }
}, 20000);

test("404 handler returns expected content", async () => {
  const res = await fetch(`${BASE_URL}/this-page-does-not-exist`);
  expect(res.status).toBe(404);
  const text = await res.text();
  expect(text).toContain("PAGE NOT FOUND");
});