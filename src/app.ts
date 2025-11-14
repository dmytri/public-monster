/// <reference types="bun-types" />
/* global Bun, process */

import { jwtVerify, createRemoteJWKSet } from "jose";

// This function will be exported and can be started with custom env vars for testing
export function startServer(env: NodeJS.ProcessEnv, port: number = 3000) {
  const HANKO_API_URL = env.HANKO_API_URL;
  const BUNNY_STORAGE_URL = env.BUNNY_STORAGE_URL;
  const BUNNY_API_KEY = env.BUNNY_API_KEY;
  const BUNNY_PULL_ZONE = env.BUNNY_PULL_ZONE;

  if (!HANKO_API_URL || !BUNNY_STORAGE_URL || !BUNNY_API_KEY) {
    throw new Error("Missing required environment variables: HANKO_API_URL, BUNNY_STORAGE_URL, BUNNY_API_KEY");
  }

  const JWKS = HANKO_API_URL ? createRemoteJWKSet(new URL(`${HANKO_API_URL}/.well-known/jwks.json`)) : null;

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
    // Simple check: reject any path containing '..' to prevent directory traversal
    if (path.includes('..')) {
      throw new Error('Invalid path: attempted directory traversal');
    }

    // Check for absolute path attempts (paths starting with / or \)
    if (path.startsWith('/') || path.startsWith('\\')) {
      throw new Error('Invalid path: attempted directory traversal');
    }

    // Prepend ~username to the path
    const prefixedPath = `~${username}/${path}`;

    // Normalize the path using Node.js path.normalize (available in Bun)
    const normalizedPath = require('path').normalize(prefixedPath);

    // Verify that the result starts with ~username
    if (!normalizedPath.startsWith(`~${username}/`) && normalizedPath !== `~${username}`) {
      throw new Error('Invalid path: attempted directory traversal');
    }

    // Return the normalized path with leading slash for storage URL
    return '/' + normalizedPath;
  }

  async function getUserInfo(token: string) {
    if (env.TEST_USER_DATA) {
      const testUsers = JSON.parse(env.TEST_USER_DATA);
      if (testUsers[token]) {
        return testUsers[token];
      }
    }
    if (token === env.TEST_AUTH_TOKEN) {
      return { userid: "test-user-id", username: env.TEST_USERNAME || "testuser" };
    }
    if (!JWKS) throw new Error("HANKO_API_URL not set");
    // Verify JWT first
    await jwtVerify(token, JWKS);

    // Get current user ID
    const meRes = await fetch(`${HANKO_API_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!meRes.ok) throw new Error('Failed to fetch user ID');
    const { id } = await meRes.json();

    // Get full user data
    const userRes = await fetch(`${HANKO_API_URL}/users/${id}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) throw new Error('Failed to fetch user');

    const user = await userRes.json();
    return { userid: id, username: user.username as string };
  }

  async function getUsername(token: string) {
    const userInfo = await getUserInfo(token);
    return userInfo.username;
  }

  function getToken(req: Request, env: NodeJS.ProcessEnv): string | null {
    // Test mode: check both cookie and Authorization header
    if (env.TEST_AUTH_TOKEN || env.TEST_USER_DATA) {
      // Check cookie first
      const cookieToken = req.cookies?.hanko ?? null;
      if (cookieToken) return cookieToken;

      // Check Authorization header for Bearer token
      const authHeader = req.headers.get("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const headerToken = authHeader.substring(7);

        // Check if it matches the main TEST_AUTH_TOKEN
        if (headerToken === env.TEST_AUTH_TOKEN) {
          return headerToken;
        }

        // Check if it matches any token in TEST_USER_DATA
        if (env.TEST_USER_DATA) {
          try {
            const testUsers = JSON.parse(env.TEST_USER_DATA);
            if (testUsers[headerToken]) {
              return headerToken;
            }
          } catch (e) {
            // If JSON parsing fails, continue with normal flow
          }
        }
      }

      // Don't fallback to TEST_AUTH_TOKEN unless explicitly provided
      return null;
    }

    // Normal mode: always use Bun's cookie parser
    return req.cookies?.hanko ?? null;
  }

  type AuthenticatedUser = { userid: string; username: string };

  type AuthedHandler = (
    req: Request,
    user: AuthenticatedUser,
  ) => Promise<Response> | Response;

  async function storagePathForUser(username: string, path: string): Promise<string> {
    // Simple check: reject any path containing '..' to prevent directory traversal
    if (path.includes('..')) {
      throw new Error('Invalid path: attempted directory traversal');
    }

    // Check for absolute path attempts (paths starting with / or \)
    if (path.startsWith('/') || path.startsWith('\\')) {
      throw new Error('Invalid path: attempted directory traversal');
    }

    // Prepend ~username to the path
    const prefixedPath = `~${username}/${path}`;

    // Normalize the path using Node.js path.normalize (available in Bun)
    const normalizedPath = require('path').normalize(prefixedPath);

    // Verify that the result starts with ~username
    if (!normalizedPath.startsWith(`~${username}/`) && normalizedPath !== `~${username}`) {
      throw new Error('Invalid path: attempted directory traversal');
    }

    // Return the normalized path with leading slash for storage URL
    return '/' + normalizedPath;
  }

  function requireAuth(env: NodeJS.ProcessEnv, handler: AuthedHandler) {
    return async (req: Request): Promise<Response> => {
      const token = getToken(req, env);
      if (!token) return new Response("Unauthorized", { status: 401 });

      let user: AuthenticatedUser;
      try {
        user = await getAuthenticatedUser(token);
      } catch (err) {
        console.log("Authentication failed:", err);
        return new Response("Unauthorized", { status: 401 });
      }

      return handler(req, user);
    };
  }

  async function getAuthenticatedUser(token: string) {
    console.log('--- Authentication Debug ---');

    // For test environment, check test tokens first (from Authorization header or passed token)
    if (env.TEST_AUTH_TOKEN) {
      console.log('Test environment detected');
      if (token === env.TEST_AUTH_TOKEN) {
        console.log('Test token matches TEST_AUTH_TOKEN, returning test user');
        return { userid: "test-user-id", username: env.TEST_USERNAME || "testuser" };
      }

      if (env.TEST_USER_DATA) {
        const testUsers = JSON.parse(env.TEST_USER_DATA);
        if (testUsers[token]) {
          console.log('Found user in TEST_USER_DATA');
          return testUsers[token];
        }
      }
    }

    console.log('Successfully found hanko token, proceeding with authentication');
    const userInfo = await getUserInfo(token);
    console.log('User info retrieved:', userInfo);
    return userInfo;
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
        POST: requireAuth(env, async (req, user) => {
          console.log('API /api/files POST called');

          const { username, userid } = user;
          console.log('User authenticated successfully:', { username, userid });

          const form = await req.formData();
          const file = form.get("file") as File;
          const path = form.get("path") as string;
          if (!file || !path) return new Response("Bad request", { status: 400 });

          // Use storagePath to validate and create the safe storage path first
          // This will catch any path traversal attempts before other checks
          let targetPath: string;
          try {
            targetPath = await storagePath(user.userid, path);
          } catch (err) {
            if (err instanceof Error && err.message.includes('directory traversal')) {
              return new Response("Invalid file path", { status: 400 });
            }
            throw err; // Re-throw if it's a different error
          }

          if (file.size > MAX_FILE_SIZE) {
            return new Response(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, { status: 413 });
          }

          // Extract the actual filename after normalization to check its extension
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
            const etagValue = Bun.hash(userid + Date.now());
            await uploadToBunny('/!' + userid + '/etag', new Blob([etagValue.toString()]));
            return new Response("OK");
          } catch (err) {
            return new Response("Upload failed", { status: 500 });
          }
        }),
        GET: requireAuth(env, async (req, user) => {
          console.log('API /api/files GET called');

          const { username, userid } = user;
          console.log('User authenticated successfully:', { username, userid });

          try {
            const files = await listFilesRecursive(`/~${username}/`, username);
            const content = JSON.stringify(files);

            let etag = '"0"';
            const etagRes = await fetch(`${BUNNY_STORAGE_URL}/!${userid}/etag`, { headers: { AccessKey: BUNNY_API_KEY } });
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
        DELETE: requireAuth(env, async (req, user) => {
          console.log('API /api/files DELETE called');

          const { username, userid } = user;
          console.log('User authenticated successfully:', { username, userid });

          const body = await req.json();
          const path = body.path;
          if (!path) return new Response("Bad request", { status: 400 });

          try {
            // Use storagePath to create the safe storage path
            const deletePath = await storagePath(user.userid, path);
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
        POST: requireAuth(env, async (req, user) => {
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
        GET: requireAuth(env, async (req, user) => {
          console.log('API /api/files/zip GET called');

          const { username } = user;
          console.log('User authenticated successfully:', { username });

          try {
            const files = await listFilesRecursive(`/~${username}/`, username);
            console.log(`Found ${files.length} files to zip for user ${username}`);

            const proc = Bun.spawn(["sh", "-c", `cd /tmp && mkdir -p ${username} && cd ${username} && rm -rf *`]);
            await proc.exited;

            for (const file of files) {
              console.log(`Processing file: ${file.ObjectName}`);
              const res = await fetch(`${BUNNY_STORAGE_URL}/~${username}/${file.ObjectName}`, { headers: { AccessKey: BUNNY_API_KEY } });
              if (res.ok) {
                const data = await res.arrayBuffer();
                const filePath = `/tmp/${username}/${file.ObjectName}`;
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

            const zipProc = Bun.spawn(["sh", "-c", `cd /tmp && zip -r ${username}.zip ${username}`]);
            await zipProc.exited;
            const stdout = await new Response(zipProc.stdout).text();
            const stderr = await new Response(zipProc.stderr).text();
            console.log('zip stdout:', stdout);
            console.log('zip stderr:', stderr);

            const zipFile = Bun.file(`/tmp/${username}.zip`);

            return new Response(zipFile, {
              headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="${username}.zip"`
              }
            });
          } catch (err) {
            console.error(err);
            return new Response("Failed to create zip", { status: 500 });
          }
        })
      },

      // API: Prepare username migration
      "/api/prepare-migration": {
        POST: requireAuth(env, async (req, user) => {
          console.log('API /api/prepare-migration POST called');

          const { username } = user;
          console.log('User authenticated successfully:', { username });

          try {
            const migrationToken = crypto.randomUUID();
            const tokenPath = `/~${username}/.migration_token`;
            await fetch(`${BUNNY_STORAGE_URL}${tokenPath}`, {
              method: "PUT",
              headers: { AccessKey: BUNNY_API_KEY },
              body: migrationToken
            });

            return new Response(JSON.stringify({ token: migrationToken }), {
              headers: { "Content-Type": "application/json" }
            });
          } catch (err) {
            console.error(err);
            return new Response("Failed to prepare migration", { status: 500 });
          }
        })
      },

      // API: Execute username migration
      "/api/migrate-username": {
        POST: requireAuth(env, async (req, user) => {
          console.log('API /api/migrate-username POST called');

          const { username: newUsername } = user;
          console.log('User authenticated successfully:', { newUsername });

          const body = await req.json();
          const oldUsername = body.oldUsername;
          const clientToken = body.token;
          if (!oldUsername || !clientToken) return new Response("Bad request", { status: 400 });

          try {
            const tokenPath = `/~${oldUsername}/.migration_token`;
            const tokenRes = await fetch(`${BUNNY_STORAGE_URL}${tokenPath}`, {
              headers: { AccessKey: BUNNY_API_KEY }
            });
            if (!tokenRes.ok) {
              return new Response("Migration token not found. Did you click 'Prepare migration' first?", { status: 403 });
            }
            const storedToken = await tokenRes.text();
            if (storedToken !== clientToken) {
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
            }

            return new Response("OK");
          } catch (err) {
            console.error(err);
            return new Response("Migration failed", { status: 500 });
          }
        })
      },

      // Static routes
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
      
      "/api/files/download/:path": requireAuth(env, async (req, user) => {
        console.log('API /api/files/download/:path called with params:', req.params);

        const { username } = user;
        console.log('User authenticated successfully:', { username });

        const filePath = req.params.path;

        if (!filePath) {
          return new Response("Bad request", { status: 400 });
        }

        try {
          // Use storagePath to create the safe storage path
          const storagePathResult = await storagePath(user.userid, filePath);

          // Fetch the file from Bunny Storage
          const res = await fetch(`${BUNNY_STORAGE_URL}${storagePathResult}`, {
            headers: { AccessKey: BUNNY_API_KEY }
          });

          if (!res.ok) {
            return new Response("File not found", { status: 404 });
          }

          // Get the file content
          const fileContent = await res.arrayBuffer();
          const fileBlob = new Blob([fileContent]);

          // Get the filename for the Content-Disposition header
          const fileName = filePath.split('/').pop() || 'download';

          return new Response(fileBlob, {
            status: 200,
            headers: {
              "Content-Disposition": `attachment; filename="${fileName}"`,
              "Content-Type": "application/octet-stream", // or detect content type
              ...res.headers // include original headers if needed
            }
          });
        } catch (err) {
          return new Response("Download failed", { status: 500 });
        }
      }),
      
      // Dynamic route for individual file downloads
      "/api/download/*": requireAuth(env, async (req, user) => {
        console.log('API /api/download/* called');
        const url = new URL(req.url);

        const { username } = user;
        console.log('User authenticated successfully for download:', { username });

        // Extract file path from URL: /api/download/filename or /api/download/dir/filename
        const filePath = url.pathname.substring('/api/download/'.length);

        if (!filePath) {
          return new Response("Bad request", { status: 400 });
        }

        try {
          // Use storagePath to create the safe storage path
          const storagePathResult = await storagePath(user.userid, filePath);

          // Fetch the file from Bunny Storage
          const res = await fetch(`${BUNNY_STORAGE_URL}${storagePathResult}`, {
            headers: { AccessKey: BUNNY_API_KEY }
          });

          if (!res.ok) {
            return new Response("File not found", { status: 404 });
          }

          // Get the file content
          const fileContent = await res.arrayBuffer();
          const fileBlob = new Blob([fileContent]);

          // Get the filename for the Content-Disposition header
          const fileName = filePath.split('/').pop() || 'download';

          return new Response(fileBlob, {
            status: 200,
            headers: {
              "Content-Disposition": `attachment; filename="${fileName}"`,
              "Content-Type": "application/octet-stream", // or detect content type
              ...res.headers // include original headers if needed
            }
          });
        } catch (err) {
          if (err instanceof Error && err.message.includes('directory traversal')) {
            return new Response("Invalid file path", { status: 400 });
          }
          return new Response("Download failed", { status: 500 });
        }
      })
    },
    // Fallback for unmatched routes
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
        // If no pull zone, or it's the same, return 404 since these are CDN paths
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
    }
  });
}