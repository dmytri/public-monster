/// <reference types="bun-types" />
import * as FilePath from 'path';
import { storagePath } from '../../utils/paths';
import { MAX_FILE_SIZE, ALLOWED_EXTENSIONS } from '../../utils/config';
import * as HTMLHintModule from 'htmlhint';

// Basic HTML validation function using htmlhint
export function validateHtml(html: string): { valid: boolean; issues: Array<{ type: string; message: string; line: number; column: number; codeSnippet: string }> } {
  // Access the actual HTMLHint object
  const HTMLHintActual = HTMLHintModule.HTMLHint;

  // Load htmlhint configuration from .htmlhintrc file
  const ruleset = {
    "tagname-lowercase": true,
    "attr-lowercase": true,
    "attr-value-double-quotes": true,
    "html-lang-require": true,
    "doctype-first": true,
    "head-script-disabled": false,
    "style-disabled": false,
    "inline-style-disabled": false,
    "id-class-value": "dash",
    "alt-require": true,
    "attr-no-duplication": true,
    "title-require": true,
    "tag-pair": true,
    "spec-char-escape": true,
    "id-unique": true,
    "src-require": true,
    "attr-unsafe-chars": true,
    "attr-whitespace": true
  };

  // Run htmlhint on the HTML content
  const messages = HTMLHintActual.verify(html, ruleset);

  // Convert htmlhint messages to our format
  const lines = html.split('\n');
  const issues = messages.map(msg => {
    // Extract the actual line content where the issue occurred
    const actualLine = msg.line && msg.line <= lines.length ? lines[msg.line - 1] : '';

    return {
      type: msg.type.toLowerCase(), // error, warning
      message: msg.message,
      line: msg.line || 0,
      column: msg.col || 0,
      codeSnippet: actualLine.trim() || (msg.raw || '')
    };
  });

  return {
    valid: issues.length === 0,
    issues: issues
  };
}

export async function listFilesRecursive(
  path: string,
  user: string,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<any[]> {
  const url = `${BUNNY_STORAGE_URL}${path}`;
  const res = await fetch(url, { headers: { AccessKey: BUNNY_API_KEY } });
  if (!res.ok) return [];

  const items = await res.json();
  let allFiles: any[] = [];

  for (const item of items) {
    if (item.IsDirectory) {
      const subFiles = await listFilesRecursive(`${path}${item.ObjectName}/`, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
      allFiles = allFiles.concat(subFiles);
    } else {
      allFiles.push({
        ObjectName: path.replace(`/~${user}/`, '') + item.ObjectName,
        Length: item.Length,
        LastChanged: item.LastChanged,
        IsDirectory: false
      });
    }
  }

  return allFiles;
}

type UserInfo = { userid: string; username: string };

export async function uploadFileHandler(
  req: Bun.BunRequest, 
  user: UserInfo, 
  BUNNY_STORAGE_URL: string, 
  BUNNY_API_KEY: string
): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file") as File;
  const path = form.get("path") as string;
  if (!file || !path) return new Response("Bad request", { status: 400 });

  if (file.size > MAX_FILE_SIZE) {
    return new Response(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, { status: 413 });
  }

  let targetPath = await storagePath(user.username, path);

  const actualFilename = targetPath.split('/').pop() || '';
  const ext = actualFilename.toLowerCase().substring(actualFilename.lastIndexOf('.'));
  if (ext === '' || !ALLOWED_EXTENSIONS.includes(ext)) {
    return new Response("File type not allowed", { status: 403 });
  }

  async function uploadToBunny(targetPath: string, blob: Blob) {
    const uploadUrl = `${BUNNY_STORAGE_URL}${targetPath}`;
    const res = await fetch(uploadUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: blob });
    if (!res.ok) throw new Error("Upload failed");
  }

  try {
    await uploadToBunny(targetPath, file);
    // Update etag after successful upload
    if (typeof globalThis.TEST === 'undefined') {
      const etagValue = Bun.hash(user.userid + Date.now());
      await uploadToBunny('/!' + user.userid + '/etag', new Blob([etagValue.toString()]));
    }
    return new Response("OK");
  } catch (err) {
    return new Response("Upload failed", { status: 500 });
  }
}

export async function listFilesHandler(
  req: Bun.BunRequest,
  user: UserInfo,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<Response> {
  try {
    const files = await listFilesRecursive(`/~${user.username}/`, user.username, BUNNY_STORAGE_URL, BUNNY_API_KEY);
    const content = JSON.stringify(files);

    let etag = Bun.hash(user.userid + Date.now());
    if (typeof globalThis.TEST === 'undefined') {
      const etagRes = await fetch(`${BUNNY_STORAGE_URL}/!${user.userid}/etag`, { headers: { AccessKey: BUNNY_API_KEY } });
      if (etagRes.ok) {
        const etagValue = await etagRes.text();
        etag = `"${etagValue}"`;
      }
    }

    const ifNoneMatch = req.headers.get("If-None-Match");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304 });
    }

    return new Response(content, {
      headers: {
        "Content-Type": "application/json",
        "ETag": etag,
        "Cache-Control": "private, must-revalidate"
      }
    });
  } catch {
    return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
  }
}

export async function getFileContentHandler(
  req: Bun.BunRequest,
  user: UserInfo,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<Response> {
  const { username } = user;

  // Extract the file path from URL parameters - the route is now "/api/files/content/*"
  const url = new URL(req.url);
  const pathname = url.pathname;

  // Extract the file path part after "/api/files/content/"
  const basePath = "/api/files/content/";
  if (!pathname.startsWith(basePath)) {
    return new Response("Invalid request path", { status: 400 });
  }

  // Get the actual file path by removing the base path
  const filePath = pathname.substring(basePath.length);
  if (!filePath) {
    return new Response("File path not specified", { status: 400 });
  }

  // Validate the file path to prevent directory traversal
  if (filePath.includes('../') || filePath.startsWith('../') || filePath.includes('/..') || filePath === '..') {
    return new Response("Invalid file path", { status: 400 });
  }

  // Use the authenticated user's username to construct the storage path
  const normalizedPath = await storagePath(username, filePath);

  try {
    const downloadUrl = `${BUNNY_STORAGE_URL}${normalizedPath}`;
    const res = await fetch(downloadUrl, { headers: { AccessKey: BUNNY_API_KEY } });

    if (!res.ok) {
      return new Response("File not found", { status: 404 });
    }

    const content = await res.text();
    return new Response(content, {
      headers: {
        "Content-Type": res.headers.get('Content-Type') || "text/html",
        "Cache-Control": "no-cache"
      }
    });
  } catch (err) {
    return new Response("Failed to retrieve file", { status: 500 });
  }
}

export async function validateHtmlHandler(
  req: Bun.BunRequest,
  user: UserInfo,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<Response> {
  const { username, userid } = user;

  // Extract path from the URL - allow for optional filename parameter
  const url = new URL(req.url);
  const searchParams = url.searchParams;
  const filePath = searchParams.get('file') || 'index.html'; // Default to index.html if no file specified

  // Validate the file path to prevent directory traversal
  if (filePath.includes('..') || filePath.startsWith('/')) {
    return new Response("Invalid file path", { status: 400 });
  }

  try {
    // Fetch the user's specified HTML content
    const normalizedPath = await storagePath(username, filePath);
    const downloadUrl = `${BUNNY_STORAGE_URL}${normalizedPath}`;
    const res = await fetch(downloadUrl, { headers: { AccessKey: BUNNY_API_KEY } });

    if (!res.ok) {
      return new Response(JSON.stringify({
        valid: false,
        issues: [{ type: "error", message: `${filePath} not found`, line: 0, column: 0 }]
      }), {
        headers: { "Content-Type": "application/json" },
        status: 404
      });
    }

    const content = await res.text();

    // Perform basic HTML validation
    const validationResults = validateHtml(content);

    // Store the validation results in the user's private space
    const reportPath = `/${userid}/html-validation-report.json`;
    const reportUrl = `${BUNNY_STORAGE_URL}${reportPath}`;
    await fetch(reportUrl, {
      method: "PUT",
      headers: { AccessKey: BUNNY_API_KEY },
      body: JSON.stringify(validationResults)
    });

    return new Response(JSON.stringify(validationResults), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      valid: false,
      issues: [{ type: "error", message: "Validation failed", line: 0, column: 0 }]
    }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
}

export async function getValidationReportHandler(
  req: Bun.BunRequest,
  user: UserInfo,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<Response> {
  const { userid } = user;

  try {
    // Fetch the stored validation report from the user's private space
    const reportPath = `/${userid}/html-validation-report.json`;
    const reportUrl = `${BUNNY_STORAGE_URL}${reportPath}`;
    const res = await fetch(reportUrl, { headers: { AccessKey: BUNNY_API_KEY } });

    if (!res.ok) {
      return new Response(JSON.stringify({
        valid: false,
        issues: [{ type: "error", message: "No validation report found", line: 0, column: 0 }]
      }), {
        headers: { "Content-Type": "application/json" },
        status: 404
      });
    }

    const report = await res.json();
    return new Response(JSON.stringify(report), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      valid: false,
      issues: [{ type: "error", message: "Failed to retrieve validation report", line: 0, column: 0 }]
    }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
}

export async function deleteFileHandler(
  req: Bun.BunRequest,
  user: UserInfo,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<Response> {
  const { username, userid } = user;

  const body = await req.json();
  const path = body.path;
  if (!path) return new Response("Bad request", { status: 400 });

  const deletePath = await storagePath(username, path);

  try {
    const deleteUrl = `${BUNNY_STORAGE_URL}${deletePath}`;
    const res = await fetch(deleteUrl, { method: "DELETE", headers: { AccessKey: BUNNY_API_KEY } });
    if (!res.ok) return new Response("Delete failed", { status: 500 });

    // Update etag after successful deletion
    const etagValue = Bun.hash(userid + Date.now());
    const etagUrl = `${BUNNY_STORAGE_URL}/!${userid}/etag`;
    if (typeof globalThis.TEST === 'undefined') {
      await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });
    }

    return new Response("OK");
  } catch (err) {
    if (err instanceof Error && (err as any).message.includes('directory traversal')) {
      return new Response("Invalid file path", { status: 400 });
    }
    return new Response("Delete failed", { status: 500 });
  }
}