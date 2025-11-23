/// <reference types="bun-types" />
import * as FilePath from 'path';
import { storagePath } from '../../utils/paths';
import { MAX_FILE_SIZE, ALLOWED_EXTENSIONS } from '../../utils/config';

// Basic HTML validation function
export function validateHtml(html: string): { valid: boolean; issues: Array<{ type: string; message: string; line: number; column: number; codeSnippet: string }> } {
  const issues: Array<{ type: string; message: string; line: number; column: number; codeSnippet: string }> = [];

  // Check for basic structural issues
  const lines = html.split('\n');

  // Look for unclosed tags - enhanced with position tracking
  const tags: Array<{ name: string; line: number; column: number; code: string }> = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)/g;
  let match;

  // Create a mapping from position to line/column number
  const posToLineCol = (pos: number): { line: number; col: number } => {
    let line = 0;
    let col = 0;
    let currentPos = 0;

    for (const [idx, lineStr] of lines.entries()) {
      if (currentPos + lineStr.length >= pos) {
        line = idx;
        col = pos - currentPos;
        break;
      }
      currentPos += lineStr.length + 1; // +1 for newline character
    }

    return { line: line + 1, col }; // Adding 1 to line to make it 1-indexed
  };

  // Reset regex to search from beginning
  tagRegex.lastIndex = 0;
  while ((match = tagRegex.exec(html)) !== null) {
    const tagName = match[1].toLowerCase();
    const posInfo = posToLineCol(match.index);

    // Get a code snippet around the tag
    const snippet = getSnippetAroundPos(lines, match.index, 100);

    if (match[0].startsWith('</')) {
      // Closing tag - check if there's a matching opening tag
      const lastTag = tags.pop();
      if (lastTag && lastTag.name !== tagName) {
        // Simple check: if we're closing a tag that wasn't opened
        issues.push({
          type: 'error',
          message: `Possible mismatch: expected closing tag for '${lastTag.name}', got closing tag for '${tagName}'`,
          line: posInfo.line,
          column: posInfo.col,
          codeSnippet: snippet
        });
      } else if (!lastTag) {
        // No opening tag for this closing tag
        issues.push({
          type: 'error',
          message: `Unmatched closing tag '${tagName}'`,
          line: posInfo.line,
          column: posInfo.col,
          codeSnippet: snippet
        });
      }
    } else {
      // Opening tag - check if it's self-closing
      const selfClosingTags = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
      if (!selfClosingTags.includes(tagName)) {
        tags.push({
          name: tagName,
          line: posInfo.line,
          column: posInfo.col,
          code: snippet
        });
      }
    }
  }

  // Report any unclosed tags
  for (const tag of tags) {
    issues.push({
      type: 'error',
      message: `Unclosed tag '${tag.name}'`,
      line: tag.line,
      column: tag.column,
      codeSnippet: tag.code
    });
  }

  // Check for missing alt attributes in img tags with position tracking
  const imgRegex = /<img\s+([^>]*?)>/gi;
  imgRegex.lastIndex = 0;
  while ((match = imgRegex.exec(html)) !== null) {
    const posInfo = posToLineCol(match.index);
    const imgTag = match[0].toLowerCase();
    const snippet = getSnippetAroundPos(lines, match.index, 100);

    if (!imgTag.includes('alt=')) {
      issues.push({
        type: 'warning',
        message: 'Image tag missing alt attribute',
        line: posInfo.line,
        column: posInfo.col,
        codeSnippet: snippet
      });
    }
  }

  // Check for proper attribute quotes with position tracking
  const unquotedAttrRegex = /<[^>]*[a-zA-Z]+=[^"'][^>\s]*[^"'\s>]/g;
  unquotedAttrRegex.lastIndex = 0;
  while ((match = unquotedAttrRegex.exec(html)) !== null) {
    const posInfo = posToLineCol(match.index);
    const snippet = getSnippetAroundPos(lines, match.index, 100);

    issues.push({
      type: 'warning',
      message: 'Attribute without quotes',
      line: posInfo.line,
      column: posInfo.col,
      codeSnippet: snippet
    });
  }

  return {
    valid: issues.length === 0,
    issues: issues
  };
}

// Helper function to extract code snippet around a specific position
function getSnippetAroundPos(lines: string[], pos: number, maxLength: number): string {
  // Find which line and col the position is at
  let currentPos = 0;
  let lineIndex = 0;
  let colIndex = 0;

  for (const [idx, line] of lines.entries()) {
    if (currentPos + line.length >= pos) {
      lineIndex = idx;
      colIndex = pos - currentPos;
      break;
    }
    currentPos += line.length + 1; // +1 for newline character
  }

  // Get the line containing the position
  if (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const start = Math.max(0, colIndex - Math.floor(maxLength / 2));
    const end = Math.min(line.length, start + maxLength);
    return line.substring(start, end).trim();
  }

  return '';
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

  // Extract path from the URL - with the route "/api/files/content/*", we need to find the file path
  const url = new URL(req.url);
  const pathname = url.pathname;

  // The path format would be /api/files/content/{username}/{file_path}
  const pathParts = pathname.split('/').filter(part => part);

  // We expect at least ['api', 'files', 'content', 'username', 'file_path...']
  if (pathParts.length < 4 || pathParts[0] !== 'api' || pathParts[1] !== 'files' || pathParts[2] !== 'content') {
    return new Response("Invalid request path", { status: 400 });
  }

  // The username in the URL should match the authenticated user
  const requestedUsername = pathParts[3];
  if (requestedUsername !== username) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Reconstruct the file path from remaining parts
  const filePathParts = pathParts.slice(4); // Everything after 'content' and 'username'
  if (filePathParts.length === 0) {
    return new Response("File path not specified", { status: 400 });
  }

  const filePath = filePathParts.join('/');
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