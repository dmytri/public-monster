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
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // User file serving
      if (url.pathname.startsWith('/~')) {
        const cdnUrl = `${BUNNY_PULL_ZONE}${url.pathname}`;
        if (BUNNY_PULL_ZONE && BUNNY_PULL_ZONE !== `${url.protocol}//${url.hostname}`) {
          return Response.redirect(cdnUrl, 303);
        }
        // If no pull zone, or it's the same, do nothing (for local dev)
        return new Response("Not found", { status: 404 });
      }

      // API routes
      if (url.pathname === '/api/files') {
        if (req.method === 'POST') {
          const token = req.headers.get("Authorization")?.replace("Bearer ", "");
          if (!token) return new Response("Unauthorized", { status: 401 });
          let username: string;
          let userid: string;
          try {
            const userInfo = await getUserInfo(token);
            username = userInfo.username;
            userid = userInfo.userid;
          } catch (err) {
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
          if (ext ==='' || !ALLOWED_EXTENSIONS.includes(ext)) {
            return new Response("File type not allowed", { status: 403 });
          }

          async function uploadToBunny(targetPath: string, blob: Blob) {
            const uploadUrl = `${BUNNY_STORAGE_URL}${targetPath}`;
            const res = await fetch(uploadUrl, { method:"PUT", headers:{ AccessKey:BUNNY_API_KEY }, body:blob });
            if (!res.ok) throw new Error("Upload failed");
          }

          try {
            const etagValue = Bun.hash(userid + Date.now());
            await uploadToBunny('/!' + userid + '/etag', new Blob([etagValue.toString()]));
            await uploadToBunny('/~' + username + '/' + path, file);
            return new Response("OK");
          } catch (err) {
            return new Response("Upload failed", { status: 500 });
          }
        }
        if (req.method === 'GET') {
          const token = req.headers.get("Authorization")?.replace("Bearer ", "");
          if (!token) return new Response("Unauthorized", { status: 401 });
          let username: string;
          let userid: string;
          try {
            const userInfo = await getUserInfo(token);
            username = userInfo.username;
            userid = userInfo.userid;
          } catch (err) {
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
        }
        if (req.method === 'DELETE') {
           const token = req.headers.get("Authorization")?.replace("Bearer ", "");
          if (!token) return new Response("Unauthorized", { status: 401 });
          let username: string;
          let userid: string;
          try {
            const userInfo = await getUserInfo(token);
            username = userInfo.username;
            userid = userInfo.userid;
          } catch (err) {
            return new Response("Unauthorized", { status: 401 });
          }

          const body = await req.json();
          const path = body.path;
          if (!path) return new Response("Bad request", { status: 400 });

          try {
            const etagValue = Bun.hash(userid + Date.now());
            const etagUrl = `${BUNNY_STORAGE_URL}/!${userid}/etag`;
            await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });
            
            const deleteUrl = `${BUNNY_STORAGE_URL}/~${username}/${path}`;
            const res = await fetch(deleteUrl, { method: "DELETE", headers: { AccessKey: BUNNY_API_KEY } });
            if (!res.ok) return new Response("Delete failed", { status: 500 });
            
            return new Response("OK");
          } catch (err) {
            return new Response("Delete failed", { status: 500 });
          }
        }
      }

      if (url.pathname === '/api/create-starter' && req.method === 'POST') {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        let username: string;
        let userid: string;
        try {
          const userInfo = await getUserInfo(token);
          username = userInfo.username;
          userid = userInfo.userid;
        } catch (err) {
          return new Response("Unauthorized", { status: 401 });
        }

        const starterHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Character encoding - always use UTF-8 -->
  <meta charset="UTF-8">

  <!-- Makes your page look good on phones and tablets -->
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- Load a fun font from Bunny Fonts (privacy-friendly!) -->
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="https://fonts.bunny.net/css?family=comic-neue:400,700" rel="stylesheet">

  <!-- This shows up in the browser tab -->
  <title>~${username} on public.monster</title>

  <!-- CSS = Cascading Style Sheets - this is where you style your page! -->
  <style>
    /* The body is everything you see on the page */
    body {
      /* Diagonal striped background - teal and magenta */
      background-image: 
        repeating-linear-gradient(
          45deg,
          #008080 0px,
          #008080 20px,
          #ff00ff 20px,
          #ff00ff 40px
        );
      font-family: "Comic Neue", "Comic Sans MS", cursive;
      color: #ffff00;  /* Yellow text */
      text-align: center;
      padding: 20px;
    }

    /* The main content box in the center */
    main {
      background: #000;  /* Black background */
      border: 5px ridge #ff00ff;  /* Magenta 3D border */
      padding: 40px;
      max-width: 600px;
      margin: 40px auto;  /* Centers the box */
      box-shadow: 10px 10px 0 rgba(255, 0, 255, 0.5);  /* Drop shadow */
    }

    /* Main heading */
    h1 {
      color: #ffff00;  /* Yellow */
      font-size: 2.5em;  /* em = relative to parent font size */
      text-shadow: 3px 3px 0 #ff00ff, 6px 6px 0 #00ffff;  /* Double shadow! */
      margin: 0 0 20px 0;
    }

    /* Paragraphs */
    p {
      font-size: 1.1em;
      line-height: 1.6;  /* Space between lines */
      margin: 15px 0;
    }

    /* Links */
    a {
      color: #00ff00;  /* Green */
      text-decoration: none;  /* No underline by default */
      font-weight: bold;
    }

    /* Links when you hover over them */
    a:hover {
      color: #ffff00;  /* Yellow */
      text-decoration: underline;
    }

    /* Info boxes */
    .box {
      background: #000;  /* Black */
      border: 3px solid #00ffff;  /* Cyan border */
      padding: 20px;
      margin: 20px 0;
      text-align: left;  /* Left-align text in boxes */
    }

    /* Code snippets */
    code {
      background: #ff00ff;  /* Magenta */
      color: #fff;  /* White text */
      padding: 2px 6px;
      font-family: monospace;  /* Fixed-width font */
    }

    /* Bold text */
    strong {
      color: #00ffff;  /* Cyan */
    }
  </style>
</head>

<!-- The body contains everything visible on your page -->
<body>

  <!-- Main content area -->
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
          const etagValue = Bun.hash(userid + Date.now());
          const etagUrl = `${BUNNY_STORAGE_URL}/!${userid}/etag`;
          await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });
          
          const uploadUrl = `${BUNNY_STORAGE_URL}/~${username}/index.html`;
          const res = await fetch(uploadUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: starterHTML });
          if (!res.ok) throw new Error("Upload failed");
          
          return new Response("OK");
        } catch (err) {
          return new Response("Failed to create starter page", { status: 500 });
        }
      }

      if (url.pathname === '/api/download-zip' && req.method === 'GET') {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        let username: string
        try {
          username = await getUsername(token);
        } catch (err) {
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

      if (url.pathname === '/api/prepare-migration' && req.method === 'POST') {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        let username: string
        try {
          username = await getUsername(token);
        } catch (err) {
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

      if (url.pathname === '/api/migrate-username' && req.method === 'POST') {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (!token) return new Response("Unauthorized", { status: 401 });
        let newUsername: string;
        try {
          newUsername = await getUsername(token);
        } catch (err) {
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
      
      // Static pages
      const serveStatic = async (filePath: string): Promise<Response | null> => {
        const file = Bun.file(filePath);
        if (!await file.exists()) return null;
        const html = await file.text();
        const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
        return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
      }
      
      let staticResponse: Response | null = null;
      if (url.pathname === '/') staticResponse = await serveStatic("index.html");
      else if (url.pathname === '/about') staticResponse = await serveStatic("about.html");
      else if (url.pathname === '/faq') staticResponse = await serveStatic("faq.html");
      else if (url.pathname === '/public_html') staticResponse = await serveStatic("filemanager.html");
      else if (url.pathname === '/profile') staticResponse = await serveStatic("profile.html");
      else if (url.pathname === '/404') staticResponse = await serveStatic("404.html");
      else if (url.pathname === '/social-card.png') return new Response(Bun.file("social-card.png"));

      if (staticResponse) return staticResponse;

      // Fallback to 404
      const notFoundHtml = await Bun.file("404.html").text();
      const withEnv = notFoundHtml.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
      return new Response(withEnv, { status: 404, headers: { "Content-Type": "text/html" } });
    }
  });
}
