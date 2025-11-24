// tests/setup.ts
// This setup file will be preloaded before all tests run
import { startServer } from "../src/app";

// Test configuration
const TEST_PORT = 3001;
const TEST_USERNAME = `_`;

// Set up the global TEST variable once before all tests, if not already set
if (typeof globalThis.TEST === 'undefined') {
  const TEST_CONFIG = Object.freeze({'username': TEST_USERNAME});
  Object.defineProperty(globalThis, "TEST", {
    value: TEST_CONFIG,
    writable: false,
    configurable: false,
    enumerable: false
  });
}

// Start the server once before all tests
console.log('~ [ TEST MODE ]');
const server = startServer(TEST_PORT, {'username': TEST_USERNAME});

// Wait for the server to start
await new Promise(resolve => setTimeout(resolve, 100));

console.log(`~ Test server running on port ${TEST_PORT}`);