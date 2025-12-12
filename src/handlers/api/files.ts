/// <reference types="bun-types" />
import * as FilePath from 'path';
import { storagePath } from '../../utils/paths';
import { MAX_FILE_SIZE, ALLOWED_EXTENSIONS, isShieldScannableFile } from '../../utils/config';
import { ArachnidShield } from '../../vendor/arachnid-shield-sdk/src/index';

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

async function scanFileWithShield(
  file: File,
  filename: string
): Promise<{ safe: boolean; reason?: string; fileData?: Uint8Array }> {
  try {
    // Read file into memory ONCE
    // (We need the bytes for both Shield and Bunny upload)
    const buffer = await file.arrayBuffer();
    const contents = new Uint8Array(buffer);

    // Create Shield client
    const shield = new ArachnidShield(
      process.env.ARACHNID_API_USERNAME!,
      process.env.ARACHNID_API_PASSWORD!
    );

    // Scan file with Shield FIRST (before any storage)
    const scanResult = await shield.scanMediaFromBytes(
      contents,
      file.type || undefined,
      file.size
    );

    // Check result
    if (scanResult.status === 'err') {
      console.error(`Shield scan error for ${filename}:`, scanResult.data);
      // On Shield API error, allow upload (fail open)
      return { safe: true, fileData: contents };
    }

    if (scanResult.data.is_match) {
      const classification = scanResult.data.classification || 'unknown';
      console.warn(`Shield BLOCK: ${filename} - ${classification}`);
      // Do NOT return fileData - file is blocked
      return {
        safe: false,
        reason: `Content flagged by safety scanner: ${classification}`
      };
    }

    // File is safe - return it for upload
    return { safe: true, fileData: contents };

  } catch (error) {
    console.error(`Shield scan exception for ${filename}:`, error);
    // On exception, allow upload (fail open to prevent DOS)
    // Still need fileData for upload
    const buffer = await file.arrayBuffer();
    return { safe: true, fileData: new Uint8Array(buffer) };
  }
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

  // ====== NEW: Shield Scanning BEFORE Storage ======
  let fileDataToUpload: File | Uint8Array = file;

  if (isShieldScannableFile(file.name)) {
    const scanResult = await scanFileWithShield(file, file.name);

    if (!scanResult.safe) {
      // File is flagged - NEVER stored anywhere
      return new Response(
        scanResult.reason || "Content blocked by safety scanner",
        { status: 451 }  // 451 Unavailable For Legal Reasons
      );
    }

    // File is safe - use the scanned bytes for upload (avoid re-reading)
    if (scanResult.fileData) {
      fileDataToUpload = scanResult.fileData;
    }
  }
  // ====== END NEW ======

  async function uploadToBunny(targetPath: string, blob: Blob | Uint8Array) {
    const uploadUrl = `${BUNNY_STORAGE_URL}${targetPath}`;
    const res = await fetch(uploadUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: blob });
    if (!res.ok) throw new Error("Upload failed");
  }

  try {
    await uploadToBunny(targetPath, fileDataToUpload);
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