import { test, expect, describe } from "bun:test";
import { setupTestHooks, TEST_USERNAME, TEST_PORT } from "./helpers";
import { ArachnidShield } from "arachnid-shield-sdk/src/index";

const BASE_URL = `http://localhost:${TEST_PORT}`;

setupTestHooks({'username': TEST_USERNAME}, TEST_PORT);

describe("Shield CSAM Scanning Integration", () => {
  test("Happy path: Upload scannable image file succeeds after Shield scan", async () => {
    // Load real test fixture image
    const imageFile = Bun.file('tests/fixtures/test-image.png');
    const imageBlob = await imageFile.arrayBuffer();

    const formData = new FormData();
    formData.append("file", new Blob([imageBlob], { type: 'image/png' }), "test-safe-image.png");
    formData.append("path", "test-safe-image.png");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: formData
    });

    // Should succeed - safe image passes Shield scan (or fail-open if unreachable)
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");

    // Verify file was actually uploaded
    const listResponse = await fetch(`${BASE_URL}/api/files`);
    const files = await listResponse.json();
    expect(files.some((f: any) => f.ObjectName === "test-safe-image.png")).toBe(true);
  }, 30000);

  test("Blocked content: Upload fails when Shield flags content (mocked)", async () => {
    // Save original method
    const originalScan = ArachnidShield.prototype.scanMediaFromBytes;

    // Mock Shield to return flagged result
    ArachnidShield.prototype.scanMediaFromBytes = async function() {
      return {
        status: 'ok',
        data: {
          is_match: true,
          classification: 'test_csam_classification',
          pdq_hash: 'mock_hash',
          near_match_details: null
        }
      };
    };

    try {
      // Load real test fixture image
      const imageFile = Bun.file('tests/fixtures/test-image.png');
      const imageBlob = await imageFile.arrayBuffer();

      const formData = new FormData();
      formData.append("file", new Blob([imageBlob], { type: 'image/png' }), "flagged-content.png");
      formData.append("path", "flagged-content.png");

      const res = await fetch(`${BASE_URL}/api/files`, {
        method: "POST",
        body: formData
      });

      // Should be blocked with 451 status
      expect(res.status).toBe(451);
      const responseText = await res.text();
      expect(responseText).toContain("Content flagged by safety scanner");
      expect(responseText).toContain("test_csam_classification");

      // Verify file was NOT uploaded
      const listResponse = await fetch(`${BASE_URL}/api/files`);
      const files = await listResponse.json();
      expect(files.some((f: any) => f.ObjectName === "flagged-content.png")).toBe(false);
    } finally {
      // Restore original method
      ArachnidShield.prototype.scanMediaFromBytes = originalScan;
    }
  }, 30000);

  test("Fail-open: Upload succeeds when Shield API errors (mocked)", async () => {
    // Save original method
    const originalScan = ArachnidShield.prototype.scanMediaFromBytes;

    // Mock Shield to return error response
    ArachnidShield.prototype.scanMediaFromBytes = async function() {
      return {
        status: 'err',
        data: 'Simulated Shield API error'
      };
    };

    try {
      // Load real test fixture image
      const imageFile = Bun.file('tests/fixtures/test-image.png');
      const imageBlob = await imageFile.arrayBuffer();

      const formData = new FormData();
      formData.append("file", new Blob([imageBlob], { type: 'image/png' }), "error-failopen.png");
      formData.append("path", "error-failopen.png");

      const res = await fetch(`${BASE_URL}/api/files`, {
        method: "POST",
        body: formData
      });

      // Should succeed - fail open on Shield error
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");

      // Verify file was uploaded despite Shield error
      const listResponse = await fetch(`${BASE_URL}/api/files`);
      const files = await listResponse.json();
      expect(files.some((f: any) => f.ObjectName === "error-failopen.png")).toBe(true);
    } finally {
      // Restore original method
      ArachnidShield.prototype.scanMediaFromBytes = originalScan;
    }
  }, 30000);

  test("Fail-open: Upload succeeds when Shield throws exception (mocked)", async () => {
    // Save original method
    const originalScan = ArachnidShield.prototype.scanMediaFromBytes;

    // Mock Shield to throw exception
    ArachnidShield.prototype.scanMediaFromBytes = async function() {
      throw new Error("Simulated network timeout");
    };

    try {
      // Load real test fixture image
      const imageFile = Bun.file('tests/fixtures/test-image.png');
      const imageBlob = await imageFile.arrayBuffer();

      const formData = new FormData();
      formData.append("file", new Blob([imageBlob], { type: 'image/png' }), "exception-failopen.png");
      formData.append("path", "exception-failopen.png");

      const res = await fetch(`${BASE_URL}/api/files`, {
        method: "POST",
        body: formData
      });

      // Should succeed - fail open on Shield exception
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");

      // Verify file was uploaded despite Shield exception
      const listResponse = await fetch(`${BASE_URL}/api/files`);
      const files = await listResponse.json();
      expect(files.some((f: any) => f.ObjectName === "exception-failopen.png")).toBe(true);
    } finally {
      // Restore original method
      ArachnidShield.prototype.scanMediaFromBytes = originalScan;
    }
  }, 30000);

  test("Non-scannable files bypass Shield entirely", async () => {
    // Upload a text file (not in SHIELD_SCANNABLE_EXTENSIONS)
    const formData = new FormData();
    formData.append("file", new Blob(["plain text content"]), "test.txt");
    formData.append("path", "test.txt");

    const res = await fetch(`${BASE_URL}/api/files`, {
      method: "POST",
      body: formData
    });

    // Should succeed without Shield scanning
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");

    // Verify file was uploaded
    const listResponse = await fetch(`${BASE_URL}/api/files`);
    const files = await listResponse.json();
    expect(files.some((f: any) => f.ObjectName === "test.txt")).toBe(true);
  }, 30000);
});
