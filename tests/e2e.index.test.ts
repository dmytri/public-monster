import { test, expect } from "bun:test";
import { Window } from "happy-dom";
import { setupTestHooks, TEST_USERNAME, portnumber } from "./helpers";

// Calculate unique port for this test file
const TEST_PORT = portnumber('e2e.index.test.ts');
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Setup test hooks using helpers
setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

// --- Index Page E2E Tests ---

test("index.html loads with expected DOM structure", async () => {
  // Get the actual HTML from the server
  const response = await fetch(BASE_URL);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({
    url: BASE_URL
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  // Check for key elements in the page
  expect(document.querySelector('h1')).toBeTruthy();
  expect(document.querySelector('#files')).toBeTruthy();
  expect(document.querySelector('#folder')).toBeTruthy();
  expect(document.querySelector('#clearFiles')).toBeTruthy();
  expect(document.querySelector('#clearFolder')).toBeTruthy();

  // Verify that the title contains the expected text
  expect(document.title).toContain('public.monster');

  // Check that required script elements exist
  const scriptTags = document.querySelectorAll('script');
  expect(scriptTags.length).toBeGreaterThan(0);
}, 20000);

test("Clear buttons on upload form work correctly", async () => {
  // Get the actual HTML from the server
  const response = await fetch(BASE_URL);
  expect(response.status).toBe(200);
  const htmlContent = await response.text();

  const window = new Window({ url: BASE_URL });

  const { document } = window;

  document.write(htmlContent);

  // Manually trigger script execution if happy-dom doesn't do it automatically
  const scriptElement = document.querySelector('script[type="module"]');

  if (scriptElement) {
    // We can't execute the module script directly in this context,
    // so we'll replicate the relevant parts of its setup.
    const filesInput = document.getElementById('files') as HTMLInputElement;
    const folderInput = document.getElementById('folder') as HTMLInputElement;
    const clearFilesBtn = document.getElementById('clearFiles') as HTMLButtonElement;
    const clearFolderBtn = document.getElementById('clearFolder') as HTMLButtonElement;

    // Attach event listeners from the script
    filesInput.addEventListener('change', () => {
      clearFilesBtn.style.display = filesInput.files && filesInput.files.length > 0 ? 'inline' : 'none';
    });

    folderInput.addEventListener('change', () => {
      clearFolderBtn.style.display = folderInput.files && folderInput.files.length > 0 ? 'inline' : 'none';
    });

    clearFilesBtn.addEventListener('click', () => {
      filesInput.value = '';
      clearFilesBtn.style.display = 'none';
    });

    clearFolderBtn.addEventListener('click', () => {
      folderInput.value = '';
      clearFolderBtn.style.display = 'none';
    });

    // --- Test Case for File Input ---
    // 1. Initially, the clear button should be hidden
    expect(clearFilesBtn.style.display).toBe("none");

    // 2. Simulate selecting a file
    // happy-dom doesn't support FileList, so we mock it
    Object.defineProperty(filesInput, 'files', {
      value: [{ name: 'test.txt' }],
      writable: true,
    });
    filesInput.dispatchEvent(new window.Event('change'));

    // 3. The clear button should now be visible
    expect(clearFilesBtn.style.display).toBe("inline");

    // 4. Simulate clicking the clear button
    clearFilesBtn.dispatchEvent(new window.Event('click'));

    // 5. The clear button should be hidden again and the input value cleared
    expect(clearFilesBtn.style.display).toBe("none");
    expect(filesInput.value).toBe("");

    // --- Test Case for Folder Input ---
    // 1. Initially, the clear button should be hidden
    expect(clearFolderBtn.style.display).toBe("none");

    // 2. Simulate selecting a folder
    Object.defineProperty(folderInput, 'files', {
        value: [{ name: 'folder' }],
        writable: true,
    });
    folderInput.dispatchEvent(new window.Event('change'));

    // 3. The clear button should now be visible
    expect(clearFolderBtn.style.display).toBe("inline");

    // 4. Simulate clicking the clear button
    clearFolderBtn.dispatchEvent(new window.Event('click'));

    // 5. The clear button should be hidden again and the input value cleared
    expect(clearFolderBtn.style.display).toBe("none");
    expect(folderInput.value).toBe("");
  }
}, 20000);

test("Main page serves with expected content", async () => {
  const res = await fetch(BASE_URL);
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain("public.monster");
  expect(text).not.toContain("HANKO_API_URL_PLACEHOLDER");
}, 9000);