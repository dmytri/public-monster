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

  async function getAuthenticatedUser(req: Request) {
    console.log('--- Authentication Debug ---');
    console.log('URL:', req.url);
    console.log('Method:', req.method);
    
    // For test environment, check test tokens first (from Authorization header)
    if (env.TEST_AUTH_TOKEN) {
      console.log('Test environment detected');
      const authHeader = req.headers.get("Authorization");
      console.log('Authorization header:', authHeader);
      
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        console.log('Extracted token from header:', token);
        if (token === env.TEST_AUTH_TOKEN) {
          console.log('Test token matches TEST_AUTH_TOKEN, returning test user');
          return { userid: "test-user-id", username: env.TEST_USERNAME || "testuser" };
        }
      }
      
      if (env.TEST_USER_DATA) {
        const authHeader = req.headers.get("Authorization");
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.substring(7);
          const testUsers = JSON.parse(env.TEST_USER_DATA);
          if (testUsers[token]) {
            console.log('Found user in TEST_USER_DATA');
            return testUsers[token];
          }
        }
      }
    }
    
    // For non-test environments, try to get token from cookies
    const cookieHeader = req.headers.get('cookie');
    console.log('Cookie header:', cookieHeader);
    
    if (!cookieHeader) {
      console.log('ERROR: No cookies found in request');
      throw new Error("No authentication token found in cookies");
    }
    
    // Parse the Cookie header
    const cookies = cookieHeader
      .split(';')
      .map(cookie => cookie.trim().split('='))
      .reduce((acc, [name, value]) => {
        acc[name] = value;
        return acc;
      }, {});
    
    console.log('Parsed cookies:', cookies);
    
    const token = cookies['hanko'];
    console.log('Hanko token from cookie:', token);
    
    if (!token) {
      console.log('ERROR: No authentication token found in hanko cookie');
      throw new Error("No authentication token found in cookies");
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
        POST: async (req) => {
          console.log('API /api/files POST called');
          let username: string;
          let userid: string;
          try {
            const userInfo = await getAuthenticatedUser(req);
            username = userInfo.username;
            userid = userInfo.userid;
            console.log('User authenticated successfully:', { username, userid });
          } catch (err) {
            console.log('Authentication failed for /api/files POST:', err);
            return new Response("Unauthorized", { status: 401 });
          }

          const form = await req.formData();
          const file = form.get("file") as File;
          const path = form.get("path") as string;
          if (!file || !path) return new Response("Bad request", { status: 400 });

          if (file.size > MAX_FILE_SIZE) {
            return new Response(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, { status: 413 });
          }

          const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
          if (ext === '' || !ALLOWED_EXTENSIONS.includes(ext)) {
            return new Response("File type not allowed", { status: 403 });
          }

          async function uploadToBunny(targetPath: string, blob: Blob) {
            const uploadUrl = `${BUNNY_STORAGE_URL}${targetPath}`;
            const res = await fetch(uploadUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: blob });
            if (!res.ok) throw new Error("Upload failed");
          }

          try {
            await uploadToBunny('/~' + username + '/' + path, file);
            // Update etag after successful upload
            const etagValue = Bun.hash(userid + Date.now());
            await uploadToBunny('/!' + userid + '/etag', new Blob([etagValue.toString()]));
            return new Response("OK");
          } catch (err) {
            return new Response("Upload failed", { status: 500 });
          }
        },
        GET: async (req) => {
          console.log('API /api/files GET called');
          let username: string;
          let userid: string;
          try {
            const userInfo = await getAuthenticatedUser(req);
            username = userInfo.username;
            userid = userInfo.userid;
            console.log('User authenticated successfully:', { username, userid });
          } catch (err) {
            console.log('Authentication failed for /api/files GET:', err);
            return new Response("Unauthorized", { status: 401 });
          }

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
        },
        DELETE: async (req) => {
          console.log('API /api/files DELETE called');
          let username: string;
          let userid: string;
          try {
            const userInfo = await getAuthenticatedUser(req);
            username = userInfo.username;
            userid = userInfo.userid;
            console.log('User authenticated successfully:', { username, userid });
          } catch (err) {
            console.log('Authentication failed for /api/files DELETE:', err);
            return new Response("Unauthorized", { status: 401 });
          }

          const body = await req.json();
          const path = body.path;
          if (!path) return new Response("Bad request", { status: 400 });

          try {
            const deleteUrl = `${BUNNY_STORAGE_URL}/~${username}/${path}`;
            const res = await fetch(deleteUrl, { method: "DELETE", headers: { AccessKey: BUNNY_API_KEY } });
            if (!res.ok) return new Response("Delete failed", { status: 500 });

            // Update etag after successful deletion
            const etagValue = Bun.hash(userid + Date.now());
            const etagUrl = `${BUNNY_STORAGE_URL}/!${userid}/etag`;
            await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });

            return new Response("OK");
          } catch (err) {
            return new Response("Delete failed", { status: 500 });
          }
        }
      },

      // API: Create starter page
      "/api/create-starter": {
        POST: async (req) => {
          console.log('API /api/create-starter POST called');
          let username: string;
          let userid: string;
          try {
            const userInfo = await getAuthenticatedUser(req);
            username = userInfo.username;
            userid = userInfo.userid;
            console.log('User authenticated successfully:', { username, userid });
          } catch (err) {
            console.log('Authentication failed for /api/create-starter POST:', err);
            return new Response("Unauthorized", { status: 401 });
          }

          const starterHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="https://fonts.bunny.net/css?family=comic-neue:400,700" rel="stylesheet">
  <title>~${username} on public.monster</title>
  <style>
    body {
      background-image: repeating-linear-gradient(45deg, #008080 0px, #008080 20px, #ff00ff 20px, #ff00ff 40px);
      font-family: "Comic Neue", "Comic Sans MS", cursive;
      color: #ffff00;
      text-align: center;
      padding: 20px;
    }
    
    main {
      background: #000;
      border: 5px ridge #ff00ff;
      padding: 40px;
      max-width: 600px;
      margin: 40px auto;
      box-shadow: 10px 10px 0 rgba(255, 0, 255, 0.5);
    }
    
    h1 {
      color: #ffff00;
      font-size: 2.5em;
      text-shadow: 3px 3px 0 #ff00ff, 6px 6px 0 #00ffff;
      margin: 0 0 20px 0;
    }
    
    p {
      font-size: 1.1em;
      line-height: 1.6;
      margin: 15px 0;
    }
    
    a {
      color: #00ff00;
      text-decoration: none;
      font-weight: bold;
    }
    
    a:hover {
      color: #ffff00;
      text-decoration: underline;
    }
    
    .box {
      background: #000;
      border: 3px solid #00ffff;
      padding: 20px;
      margin: 20px 0;
      text-align: left;
    }
    
    code {
      background: #ff00ff;
      color: #fff;
      padding: 2px 6px;
      font-family: monospace;
    }
    
    strong {
      color: #00ffff;
    }
  </style>
</head>
<body>
  <main>
    <h1>🌐 Welcome to ~${username}!</h1>
    <p><strong>You're live on the web!</strong> This is your starter page. Download it, edit it, make it yours.</p>
    <div class="box">
      <p><strong>✏️ How to edit:</strong></p>
      <p>1. Go to <a href="https://public.monster/public_html">public_html</a><br>
      2. Download <code>index.html</code><br>
      3. Edit it with any text editor<br>
      4. Upload it back</p>
    </div>
    <div class="box">
      <p><strong>💡 Tips:</strong></p>
      <p>• HTML is just text with tags like <code>&lt;p&gt;</code> and <code>&lt;a&gt;</code><br>
      • Check the <a href="https://public.monster/faq">FAQ</a> for help with links and images</p>
    </div>
    <p>🚧 <em>Under construction since ${new Date().getFullYear()}</em> 🚧</p>
    <p><a href="https://public.monster">← public.monster</a></p>
  </main>
</body>
</html>`;

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
        }
      },

      // API: Download all files as zip
      "/api/files/zip": {
        GET: async (req) => {
          console.log('API /api/files/zip GET called');
          let username: string;
          try {
            const userInfo = await getAuthenticatedUser(req);
            username = userInfo.username;
            console.log('User authenticated successfully:', { username });
          } catch (err) {
            console.log('Authentication failed for /api/files/zip GET:', err);
            return new Response("Unauthorized", { status: 401 });
          }

          try {
            const files = await listFilesRecursive(`/~${username}/`, username);

            const proc = Bun.spawn(["sh", "-c", `cd /tmp && mkdir -p ${username} && cd ${username} && rm -rf *`]);
            await proc.exited;

            for (const file of files) {
              const res = await fetch(`${BUNNY_STORAGE_URL}${file.path}`, { headers: { AccessKey: BUNNY_API_KEY } });
              if (res.ok) {
                const data = await res.arrayBuffer();
                const filePath = `/tmp/${username}/${file.ObjectName}`;
                const dir = filePath.substring(0, filePath.lastIndexOf('/'));
                if (dir) {
                  const mkdirProc = Bun.spawn(["mkdir", "-p", dir]);
                  await mkdirProc.exited;
                }
                await Bun.write(filePath, data);
              }
            }

            const zipProc = Bun.spawn(["sh", "-c", `cd /tmp && zip -r ${username}.zip ${username}`]);
            await zipProc.exited;

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
        }
      },

      // API: Prepare username migration
      "/api/prepare-migration": {
        POST: async (req) => {
          console.log('API /api/prepare-migration POST called');
          let username: string;
          try {
            const userInfo = await getAuthenticatedUser(req);
            username = userInfo.username;
            console.log('User authenticated successfully:', { username });
          } catch (err) {
            console.log('Authentication failed for /api/prepare-migration POST:', err);
            return new Response("Unauthorized", { status: 401 });
          }

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
        }
      },

      // API: Execute username migration
      "/api/migrate-username": {
        POST: async (req) => {
          console.log('API /api/migrate-username POST called');
          let newUsername: string;
          try {
            const userInfo = await getAuthenticatedUser(req);
            newUsername = userInfo.username;
            console.log('User authenticated successfully:', { newUsername });
          } catch (err) {
            console.log('Authentication failed for /api/migrate-username POST:', err);
            return new Response("Unauthorized", { status: 401 });
          }

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
        }
      },

      // Static routes
      "/": async () => {
        const file = Bun.file("index.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/about": async () => {
        const file = Bun.file("about.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/faq": async () => {
        const file = Bun.file("faq.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/public_html": async () => {
        const file = Bun.file("filemanager.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/profile": async () => {
        const file = Bun.file("profile.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      },
      
      "/404": async () => {
        const file = Bun.file("404.html");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { status: 404, headers: { "Content-Type": "text/html" } });
      },
      
      "/social-card.png": async () => {
        const file = Bun.file("social-card.png");
        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(file, { headers: { "Content-Type": "image/png" } });
      },
      
      "/api/files/download/:path": async (req) => {
        console.log('API /api/files/download/:path called with params:', req.params);
        let username: string;
        try {
          const userInfo = await getAuthenticatedUser(req);
          username = userInfo.username;
          console.log('User authenticated successfully:', { username });
        } catch (err) {
          console.log('Authentication failed for /api/files/download/:path:', err);
          return new Response("Unauthorized", { status: 401 });
        }

        const filePath = req.params.path;
        
        if (!filePath) {
          return new Response("Bad request", { status: 400 });
        }

        try {
          // Fetch the file from Bunny Storage
          const res = await fetch(`${BUNNY_STORAGE_URL}/~${username}/${filePath}`, {
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
      },
      
      // Dynamic route for individual file downloads
      "/api/download/*": async (req) => {
        console.log('API /api/download/* called');
        const url = new URL(req.url);
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) {
          console.log('No token found in /api/download/* request');
          return new Response("Unauthorized", { status: 401 });
        }
        
        let username: string;
        try {
          username = await getUsername(token);
          console.log('User authenticated successfully for download:', { username });
        } catch (err) {
          console.log('Authentication failed for /api/download/*:', err);
          return new Response("Unauthorized", { status: 401 });
        }

        // Extract file path from URL: /api/download/filename or /api/download/dir/filename
        const filePath = url.pathname.substring('/api/download/'.length);
        
        if (!filePath) {
          return new Response("Bad request", { status: 400 });
        }

        try {
          // Fetch the file from Bunny Storage
          const res = await fetch(`${BUNNY_STORAGE_URL}/~${username}/${filePath}`, {
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
      }
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
      const file = Bun.file("404.html");
      if (!await file.exists()) {
        return new Response("Page not found", { status: 404 });
      }
      const html = await file.text();
      const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
      return new Response(withEnv, { status: 404, headers: { "Content-Type": "text/html" } });
    }
  });
}