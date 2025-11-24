import type { Server } from "bun";
import { startServer } from "../src/app";

// --- Test Configuration ---
export const DEFAULT_PORT = 3000;
export const TEST_USERNAME = `_`;

// Function to calculate port number based on string input
export function portnumber(s: string): number {
  return DEFAULT_PORT + (Array.from(s).reduce((a, c) => a + c.charCodeAt(0), 0) % 1000);
}

// Port numbers for specific test files
export const TEST_PORT = portnumber('server.files.test.ts');
export const TEST_PORT_ALT = portnumber('e2e.filemanager.test.ts');
export const BASE_URL = `http://localhost:${TEST_PORT}`;
export const BASE_URL_ALT = `http://localhost:${TEST_PORT_ALT}`;

// --- Test Server Management ---
// Track server instances by port to support multiple test runs
const serverInstances: Map<number, Server> = new Map();

// For test environments, we'll try to set the TEST variable but handle conflicts gracefully
let testEnvironmentInitialized = false;
const INITIAL_TEST_CONFIG = {'username': TEST_USERNAME};

export function setupTestServer(testConfig: Record<string, string | number | boolean> = {'username': TEST_USERNAME}, port: number = TEST_PORT): Server {
  // Try to set up the test environment if not already initialized
  if (!testEnvironmentInitialized) {
    try {
      Object.freeze(INITIAL_TEST_CONFIG);
      Object.defineProperty(globalThis, "TEST", {
        value: INITIAL_TEST_CONFIG, writable: false, configurable: false, enumerable: false
      });
      testEnvironmentInitialized = true;
    } catch (error) {
      // If the property is already defined as readonly, we continue anyway
      console.debug("TEST variable already defined, continuing...");
    }
  }

  // Don't pass the testConfig to startServer to avoid redefining TEST variable
  // The TEST variable has already been set up above or in the preload
  const server = startServer(port); // Pass no test config to avoid redefining TEST
  serverInstances.set(port, server);
  return server;
}

export async function waitForServer(): Promise<void> {
  await Bun.sleep(50); // Wait for server to start
}

export async function teardownTestServer(port: number = TEST_PORT): Promise<void> {
  const server = serverInstances.get(port);
  if (server) {
    server.stop(true);
    await Bun.sleep(1000);
    serverInstances.delete(port);
  }
}

// --- Test Hooks Setup ---
export function setupTestHooks(testConfig: Record<string, string | number | boolean> = {'username': TEST_USERNAME}, port: number = TEST_PORT): void {
  beforeAll(async () => {
    setupTestServer(testConfig, port);
    await waitForServer();
  });

  beforeEach(async () => {
    await cleanupUserFiles(port);
  });

  afterAll(async () => {
    await cleanupUserFiles(port);
    await teardownTestServer(port);
  });
}

// --- File Management Utilities ---
export async function cleanupUserFiles(port: number = TEST_PORT): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/api/files`);
    if (!res.ok) return;

    const files = await res.json();
    for (const file of files) {
      await fetch(`http://localhost:${port}/api/files`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: file.ObjectName }),
      });
    }
  } catch (error) {
    // If cleanup fails, we just continue - it shouldn't break the tests
    console.warn("Cleanup failed:", error);
  }
}

export async function uploadFile(path: string, content: string | Blob, filename?: string, port: number = TEST_PORT): Promise<Response> {
  const formData = new FormData();
  const fileBlob = typeof content === 'string' ? new Blob([content]) : content;
  const safeFilename = filename || path.split('/').pop() || 'file';

  formData.append("file", fileBlob, safeFilename);
  formData.append("path", path);

  return await fetch(`http://localhost:${port}/api/files`, {
    method: "POST",
    body: formData
  });
}

export async function deleteFile(path: string, port: number = TEST_PORT): Promise<Response> {
  return await fetch(`http://localhost:${port}/api/files`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: path }),
  });
}

export async function listFiles(port: number = TEST_PORT): Promise<any[]> {
  const res = await fetch(`http://localhost:${port}/api/files`);
  if (!res.ok) {
    throw new Error(`Failed to list files: ${res.status}`);
  }
  return await res.json();
}

// --- API Request Helpers ---
export async function createStarterPage(port: number = TEST_PORT): Promise<Response> {
  return await fetch(`http://localhost:${port}/api/create-starter`, {
    method: "POST",
  });
}

export async function downloadZip(port: number = TEST_PORT): Promise<Blob> {
  const res = await fetch(`http://localhost:${port}/api/files/zip`);
  if (!res.ok) {
    throw new Error(`Failed to download zip: ${res.status}`);
  }
  return await res.blob();
}

// --- DOM Testing Utilities for E2E Tests ---
export async function loadHTMLFile(filePath: string, url?: string, port: number = TEST_PORT): Promise<{ window: any, document: Document }> {
  const htmlContent = await Bun.file(filePath).text();
  const { Window } = await import("happy-dom");

  const window = new Window({
    url: url || `http://localhost:${port}`
  });

  const { document } = window;
  document.write(htmlContent);
  document.close();

  return { window, document };
}

export function simulateFileInput(
  window: any, 
  elementId: string, 
  files: File[], 
  eventType: string = 'change'
): void {
  const inputElement = window.document.getElementById(elementId) as HTMLInputElement;
  if (!inputElement) {
    throw new Error(`Element with ID ${elementId} not found`);
  }

  // Create a mock FileList
  const fileMap = {} as FileList;
  files.forEach((file, index) => {
    fileMap[index] = file;
  });
  fileMap.length = files.length;
  fileMap.item = (index: number) => fileMap[index];

  // Assign the files to the input element
  Object.defineProperty(inputElement, 'files', {
    value: fileMap,
    writable: true,
  });

  // Dispatch the event to trigger any listeners
  inputElement.dispatchEvent(new window.Event(eventType));
}

// --- Test Environment Utilities ---
export function simulateUserSession(username: string, userId: string = 'test-user-id'): Record<string, any> {
  return {
    "test-token": { 
      userid: userId, 
      username: username 
    }
  };
}