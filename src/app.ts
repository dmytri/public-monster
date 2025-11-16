/// <reference types="bun-types" />
/* global Bun, process */

import * as FilePath from 'path';

declare global {
  var TEST: Readonly<Record<string, string | number | boolean>> | undefined
}

class InvalidPathError extends Error {}

export function startServer(port: number = 3000, test: Record<string, string | number | boolean> = {}) {
  if (test) {
    console.log('TEST MODE')
    Object.freeze(test)
    Object.defineProperty(globalThis, "TEST", {
      value: test, writable: false, configurable: false, enumerable: false
    })
  }

  const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;
  const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
  const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
  const HANKO_API_URL = process.env.HANKO_API_URL;

  Object.freeze(process.env)

  if (!HANKO_API_URL || !BUNNY_STORAGE_URL || !BUNNY_API_KEY) {
    throw new Error("Missing required environment variables: HANKO_API_URL, BUNNY_STORAGE_URL, BUNNY_API_KEY");
  }

  // Abuse prevention config
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
  const ALLOWED_EXTENSIONS = [
    // source
    '.html', '.htm',
    '.shtml', '.shtm',
    '.xhtml', '.xht',
    '.css', '.js', '.mjs',
    '.md', '.mdx', '.jsx', '.riot', '.tag',

    // fonts
    '.woff', '.woff2', '.ttf', '.otf',

    // images
    '.png', '.jpg', '.jpeg', '.gif',
    '.webp', '.svg', '.svgz', '.ico',
    '.avif', '.heic', '.heif',
    '.bmp', '.tiff', '.tif',

    // media
    '.mp4', '.webm', '.mp3', '.wav',
    '.mid', '.midi', '.ogg', '.ogv',
    '.mov', '.qt',

    // 3d
    '.glb', '.gltf',

    '.txt', '.json', '.xml', '.csv', '.tsv', '.yaml', '.yml',
    '.ini', '.conf', '.properties', '.env',

    // feeds
    '.rss', '.atom', '.rdf',

    // archives
    '.zip', '.tar', '.tgz', '.gz', '.bz2', '.xz', '.7z',

    // documents
    '.pdf',

    // manifests / maps
    '.webmanifest', '.map'
  ];

  async function storagePath(username: string, path: string): Promise<string> {
    if (path.startsWith('\\'))
      throw new InvalidPathError('Invalid path');

    if (path.includes('..'))
      throw new InvalidPathError('Invalid path: attempted directory traversal');

    const base = FilePath.posix.resolve(`/~${username}/`);
    const resolvedPath = FilePath.posix.resolve(base, path);

    if (!resolvedPath.startsWith(base))
      throw new InvalidPathError('Invalid path: directory traversal detected');

    return resolvedPath;
  }

  type UserInfo = { userid: string; username: string };

  async function getUserInfo (req: Bun.BunRequest): Promise<UserInfo> {

    if (TEST && typeof TEST.username == 'string')
      return {userid: 'TEST_USERID', username: TEST.username };

    let token: string | null = req.cookies.get('hanko');

    if (!token)
      throw new Error('No Auth Token Found');
  
    const meRes = await fetch(`${HANKO_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!meRes.ok) throw new Error('Failed to fetch user ID');
    const { id } = await meRes.json();

    const userRes = await fetch(`${HANKO_API_URL}/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) throw new Error('Failed to fetch user');

    const user = await userRes.json();

    if (!/^[a-zA-Z0-9_-]+$/.test(user.username)) {
      throw new Error('Invalid username')
    }

    return Object.freeze({ userid: id as string, username: user.username as string });
  }

  type AuthedHandler = (
    req: Bun.BunRequest,
    user: UserInfo,
  ) => Promise<Response> | Response;

  function requireAuth(handler: AuthedHandler) {
    return async (req: Bun.BunRequest): Promise<Response> => {
      let user: UserInfo = await getUserInfo(req);
      return handler(req, user);
    };
  }

  async function listFilesRecursive(path: string, user: string): Promise<any[]> {
    const url = `${BUNNY_STORAGE_URL}${path}`;
    const res = await fetch(url, { headers: { AccessKey: BUNNY_API_KEY } });
    if (!res.ok) return [];

    const items = await res.json();
    let allFiles: any[] = [];

    for (const item of items) {
      if (item.IsDirectory) {
        const subFiles = await listFilesRecursive(`${path}${item.ObjectName}/`, user);
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

  console.log('~ public.monster')
  return Bun.serve({
    hostname: '0.0.0.0',
    port: port,
    routes: {
      // API: Upload, List, Delete files
      "/api/files": {
        POST: requireAuth(async (req, user) => {
          console.log('API /api/files POST called');

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
          console.log('extension', ext)
          if (ext === '' || !ALLOWED_EXTENSIONS.includes(ext)) {
            return new Response("File type not allowed", { status: 403 });
          }

          console.log('valid path', targetPath)
          async function uploadToBunny(targetPath: string, blob: Blob) {
            console.log('uploading', targetPath)
            const uploadUrl = `${BUNNY_STORAGE_URL}${targetPath}`;
            const res = await fetch(uploadUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: blob });
            if (!res.ok) throw new Error("Upload failed");
          }

          try {
            await uploadToBunny(targetPath, file);
            // Update etag after successful upload
            const etagValue = Bun.hash(user.userid + Date.now());
            await uploadToBunny('/!' + user.userid + '/etag', new Blob([etagValue.toString()]));
            return new Response("OK");
          } catch (err) {
            return new Response("Upload failed", { status: 500 });
          }
        }),
        GET: requireAuth(async (req, user) => {
          console.log('API /api/files GET called');

          try {
            const files = await listFilesRecursive(`/~${user.username}/`, user.username);
            const content = JSON.stringify(files);

            let etag = '"0"';
            const etagRes = await fetch(`${BUNNY_STORAGE_URL}/!${user.userid}/etag`, { headers: { AccessKey: BUNNY_API_KEY } });
            if (etagRes.ok) {
              const etagValue = await etagRes.text();
              etag = `"${etagValue}"`;
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
        }),
        DELETE: requireAuth(async (req, user) => {
          console.log('API /api/files DELETE called');

          const { username, userid } = user;
          console.log('User authenticated successfully:', { username, userid });

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
            await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });

            return new Response("OK");
          } catch (err) {
            if (err instanceof Error && err.message.includes('directory traversal')) {
              return new Response("Invalid file path", { status: 400 });
            }
            return new Response("Delete failed", { status: 500 });
          }
        })
      },

      // API: Create starter page
      "/api/create-starter": {
        POST: requireAuth(async (req, user) => {
          console.log('API /api/create-starter POST called');

          const { username, userid } = user;
          console.log('User authenticated successfully:', { username, userid });

          // Read the starter HTML template from public/starter.html
          const file = Bun.file("./public/starter.html");
          if (!await file.exists()) {
            return new Response("Starter template not found", { status: 500 });
          }
          let starterHTML = await file.text();

          // Replace placeholders with actual values
          starterHTML = starterHTML.replace(/USERNAME_PLACEHOLDER/g, username);
          starterHTML = starterHTML.replace(/CURRENT_YEAR_PLACEHOLDER/g, new Date().getFullYear().toString());

          try {
            const uploadUrl = `${BUNNY_STORAGE_URL}/~${username}/index.html`;
            const res = await fetch(uploadUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: starterHTML });
            if (!res.ok) throw new Error("Upload failed");

            // Update etag after successful upload
            const etagValue = Bun.hash(userid + Date.now());
            const etagUrl = `${BUNNY_STORAGE_URL}/!${userid}/etag`;
            await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });

            return new Response("OK");
          } catch (err) {
            return new Response("Failed to create starter page", { status: 500 });
          }
        })
      },

      // API: Download all files as zip
      "/api/files/zip": {
        GET: requireAuth(async (req, user) => {
          console.log('API /api/files/zip GET called');

          try {
            const files = await listFilesRecursive(`/~${user.username}/`, user.username);
            console.log(`Found ${files.length} files to zip for user ${user.username}`);

            const proc = Bun.spawn(["sh", "-c", `cd /tmp && mkdir -p ${user.username} && cd ${user.username} && rm -rf *`]);
            await proc.exited;

            for (const file of files) {
              console.log(`Processing file: ${file.ObjectName}`);
              const res = await fetch(`${BUNNY_STORAGE_URL}/~${user.username}/${file.ObjectName}`, { headers: { AccessKey: BUNNY_API_KEY } });
              if (res.ok) {
                const data = await res.arrayBuffer();
                const filePath = `/tmp/${user.username}/${file.ObjectName}`;
                console.log(`Writing file to: ${filePath}`);
                const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                if (dir) {
                  const mkdirProc = Bun.spawn(["mkdir", "-p", dir]);
                  await mkdirProc.exited;
                }
                await Bun.write(filePath, data);
              } else {
                console.log(`Failed to fetch file: ${file.ObjectName}`);
              }
            }

            const zipProc = Bun.spawn(["sh", "-c", `cd /tmp && zip -r ${user.username}.zip ${user.username}`]);
            await zipProc.exited;
            const stdout = await new Response(zipProc.stdout).text();
            const stderr = await new Response(zipProc.stderr).text();
            console.log('zip stdout:', stdout);
            console.log('zip stderr:', stderr);

            const zipFile = Bun.file(`/tmp/${user.username}.zip`);

            return new Response(zipFile, {
              headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${user.username}.zip"`
              }
            });
          } catch (err) {
            console.error(err);
            return new Response("Failed to create zip", { status: 500 });
          }
        })
      },

      "/api/prepare-migration": {
        GET: requireAuth(async (req, user) => {
          console.log('API /api/prepare-migration POST called');
          const tokenPath = `/~${user.username}/.migration_token`;
          await fetch(`${BUNNY_STORAGE_URL}${tokenPath}`, {
            method: "PUT",
            headers: { AccessKey: BUNNY_API_KEY },
            body: user.userid
          });
        })
      },

      "/api/migrate-username": {
        POST: requireAuth(async (req, user) => {
          console.log('API /api/migrate-username POST called');

          const body = await req.json();

          let oldUsername = body.old;
          let newUsername = user.username

          if (TEST && typeof TEST.username == 'string') {
            oldUsername = newUsername
            newUsername = oldUsername
          }

          if (!oldUsername) return new Response("Bad request", { status: 400 });

          try {
            const tokenPath = `/~${oldUsername}/.migration_token`;
            const tokenRes = await fetch(`${BUNNY_STORAGE_URL}${tokenPath}`, {
              headers: { AccessKey: BUNNY_API_KEY }
            });
            if (!tokenRes.ok) {
              return new Response("Migration token not found. Did you click 'Prepare migration' first?", { status: 409 });
            }
            const storedToken = await tokenRes.text();
            if (storedToken !== user.userid) {
              return new Response("Invalid migration token", { status: 403 });
            }

            const files = await listFilesRecursive(`/~${oldUsername}/`, oldUsername);

            for (const file of files) {
              const downloadUrl = `${BUNNY_STORAGE_URL}/~${oldUsername}/${file.ObjectName}`;
              const downloadRes = await fetch(downloadUrl, {
                headers: { AccessKey: BUNNY_API_KEY }
              });
              if (!downloadRes.ok) continue;
              const data = await downloadRes.arrayBuffer();

              const uploadRes = await fetch(`${BUNNY_STORAGE_URL}/~${newUsername}/${file.ObjectName}`, {
                method: "PUT",
                headers: { AccessKey: BUNNY_API_KEY },
                body: data
              });
              if (!uploadRes.ok) throw new Error(`Upload failed`);

              // Delete old file
              await fetch(`${BUNNY_STORAGE_URL}/~${oldUsername}/${file.ObjectName}`, {
                method: "DELETE",
                headers: { AccessKey: BUNNY_API_KEY }
              });

              if (TEST && typeof TEST.username == 'string') {
              // Delete new file for tests too
                await fetch(`${BUNNY_STORAGE_URL}/~${oldUsername}/${file.ObjectName}`, {
                  method: "DELETE",
                  headers: { AccessKey: BUNNY_API_KEY }
                });
              }
            }

            return new Response("OK");
          } catch (err) {
            console.error(err);
            return new Response("Migration failed", { status: 500 });
          }
        })
      },

      "/": async () => {
        const file = Bun.file("./public/index.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/about": async () => {
        const file = Bun.file("./public/about.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/faq": async () => {
        const file = Bun.file("./public/faq.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/public_html": async () => {
        const file = Bun.file("./public/filemanager.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/profile": async () => {
        const file = Bun.file("./public/profile.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/404": async () => {
        const file = Bun.file("./public/404.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { status: 404, headers: { "Content-Type": "text/html" } });
      },
      
      "/social-card.png": async () => {
        const file = Bun.file("./public/social-card.png");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(file, { headers: { "Content-Type": "image/png" } });
      },
    },

    async fetch(req) {
      console.log('Fetch handler called for URL:', req.url, 'Method:', req.method);
      const url = new URL(req.url);

      // User file serving (moved from named routes)
      if (url.pathname.startsWith('/~')) {
        const cdnUrl = `${BUNNY_PULL_ZONE}${url.pathname}`;
        if (BUNNY_PULL_ZONE && BUNNY_PULL_ZONE !== `${url.protocol}//${url.hostname}`) {
          console.log('Redirecting to CDN for user file:', cdnUrl);
          return Response.redirect(cdnUrl, 303);
        }
        console.log('No pull zone configured, returning 404 for user file path:', url.pathname);
        return new Response("Not found", { status: 404 });
      }

      console.log('Serving 404 page for unmatched route:', url.pathname);
      const file = Bun.file("./public/404.html");
      if (!await file.exists()) {
        return new Response("Page not found", { status: 404 });
      }
      const html = await file.text();
      const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
      return new Response(withEnv, { status: 404, headers: { "Content-Type": "text/html" } });
    },
    error(err) {
      if (err instanceof InvalidPathError) {
        return new Response("Invalid file path", { status: 400 });
      }
     throw err;
    }
  });
}
