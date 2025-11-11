/// <reference types="bun-types" />
/* global Bun, process */

import { jwtVerify, createRemoteJWKSet } from "jose";

const HANKO_API_URL = process.env.HANKO_API_URL;
const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

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
Bun.serve({
  hostname: '0.0.0.0',
  port: 3000,
  routes: {
    "/~*": req => {
      const url = new URL(req.url);
      const cdnUrl = `${BUNNY_PULL_ZONE}/${url.pathname}`;
      console.log(BUNNY_PULL_ZONE, `${url.protocol}${url.hostname}`)
      if (BUNNY_PULL_ZONE !== `${url.protocol}${url.hostname}`) {
        return Response.redirect(cdnUrl, 303);
      }
    },
    "/api/files": {
      POST: async req => {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
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
        
        // File size check
        if (file.size > MAX_FILE_SIZE) {
          return new Response(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, { status: 413 });
        }

        // File type check
        const ext = path.toLowerCase().substring(path.lastIndexOf('.'));
        if (ext ==='' || !ALLOWED_EXTENSIONS.includes(ext)) {
          return new Response("File type not allowed", { status: 403 });
        }

        async function uploadToBunny(targetPath: string, blob: Blob) {
          const url = BUNNY_STORAGE_URL + '/' + encodeURI(targetPath);
          const res = await fetch(url, { method:"PUT", headers:{ AccessKey:BUNNY_API_KEY }, body:blob });
          if (!res.ok) throw new Error("Upload failed");
        }

        try {
          // Update ETag first
          const etagValue = Bun.hash(userid + Date.now());
          await uploadToBunny('/!' + userid + '/etag', new Blob([etagValue.toString()]));
          
          await uploadToBunny('/~' + username + '/' + path, file);
          
          return new Response("OK");
        } catch (err) {
          return new Response("Upload failed", { status: 500 });
        }
      },
      GET: async req => {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
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
          
          // Read ETag from etags file
          let etag = '"0"';
          const etagRes = await fetch(`${BUNNY_STORAGE_URL}/!${userid}/etag`, { headers: { AccessKey: BUNNY_API_KEY } });
          if (etagRes.ok) {
            const etagValue = await etagRes.text();
            etag = `"${etagValue}"`;
          }
          
          // Check If-None-Match header for conditional request
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
      DELETE: async req => {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
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
          // Update ETag first
          const etagValue = Bun.hash(userid + Date.now());
          const etagUrl = `${BUNNY_STORAGE_URL}/!${userid}/etag`;
          await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });
          
          const url = `${BUNNY_STORAGE_URL}/~${username}/${path}`;
          const res = await fetch(url, { method: "DELETE", headers: { AccessKey: BUNNY_API_KEY } });
          if (!res.ok) return new Response("Delete failed", { status: 500 });
          
          return new Response("OK");
        } catch {
          return new Response("Delete failed", { status: 500 });
        }
      }
    },
    "/api/download-zip": {
      GET: async req => {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        let username: string
        try {
          username = await getUsername(token);
        } catch (err) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          const files = await listFilesRecursive(`/~${username}/`, username);
          
          const proc = Bun.spawn(["sh", "-c", `cd /tmp && mkdir -p ${username} && cd ${username} && rm -rf * && mkdir -p \$(dirname "$1") 2>/dev/null || true`]);
          await proc.exited;
          
          // Download all files to temp directory
          for (const file of files) {
            const res = await fetch(`${BUNNY_STORAGE_URL}${file.path}`, { headers: { AccessKey: BUNNY_API_KEY } });
            if (res.ok) {
              const data = await res.arrayBuffer();
              const filePath = `/tmp/${username}/${file.ObjectName}`;
              const dir = filePath.substring(0, filePath.lastIndexOf('/'));
              await Bun.write(`/tmp/mkdir_${username}.sh`, `mkdir -p "${dir}"`);
              const mkdirProc = spawn(["sh", `/tmp/mkdir_${username}.sh`]);
              await mkdirProc.exited;
              await Bun.write(filePath, data);
            }
          }
          
          // Create zip
          const zipProc = spawn(["sh", "-c", `cd /tmp && zip -r ${username}.zip ${username}`]);
          await zipProc.exited;
          
          const zipFile = Bun.file(`/tmp/${username}.zip`);
          const zipData = await zipFile.arrayBuffer();
          
          // Cleanup
          spawn(["sh", "-c", `rm -rf /tmp/${username} /tmp/${username}.zip /tmp/mkdir_${username}.sh`]);
          
          return new Response(zipData, {
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
    "/api/prepare-migration": {
      POST: async req => {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        let username: string
        try {
          username = await getUsername(token);
        } catch (err) {
          return new Response("Unauthorized", { status: 401 });
        }

        try {
          // Generate random token
          const migrationToken = crypto.randomUUID();
          
          // Store token in user's directory
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
    "/api/migrate-username": {
      POST: async req => {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
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
          // Verify ownership token
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
          
          // List all files in old directory
          const files = await listFilesRecursive(`/~${oldUsername}/`, oldUsername);
          console.log(`Migrating ${files.length} files from ~${oldUsername}/ to ~${newUsername}/`);
          
          // Copy each file to new location
          for (const file of files) {
            
            // Download from old location
            const downloadUrl = `${BUNNY_STORAGE_URL}/~${oldUsername}/${file.ObjectName}`;
            console.log(`Downloading: ${downloadUrl}`);
            const downloadRes = await fetch(downloadUrl, {
              headers: { AccessKey: BUNNY_API_KEY }
            });
            if (!downloadRes.ok) {
              console.error(`Failed to download ${file.ObjectName}`);
              continue;
            }
            const data = await downloadRes.arrayBuffer();
            
            // Upload to new location
            const uploadRes = await fetch(`${BUNNY_STORAGE_URL}/~${newUsername}/${file.ObjectName}`, {
              method: "PUT",
              headers: { AccessKey: BUNNY_API_KEY },
              body: data
            });
            if (!uploadRes.ok) {
              console.error(`Failed to upload ${newUsername}`);
              throw new Error(`Upload failed`);
            }
            console.log(`Migrated: ${file.ObjectName} -> ${newUsername}`);
            
            // Delete old file
            await fetch(`${BUNNY_STORAGE_URL}/${file.ObjectName}`, {
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
    "/api/create-starter": {
      POST: async req => {
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
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
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="preconnect" href="https://fonts.bunny.net">
  <link href="https://fonts.bunny.net/css?family=comic-neue:400,700" rel="stylesheet">
  <title>~${username} on public.monster</title>
  <style>
    /* 90s diagonal stripes background */
    body {
      background: linear-gradient(45deg, #008080 25%, #ff00ff 25%, #ff00ff 50%, #008080 50%, #008080 75%, #ff00ff 75%, #ff00ff);
      background-size: 40px 40px;
      font-family: "Comic Neue", "Comic Sans MS", cursive;
      color: #000;
      padding: 20px;
      animation: bg-scroll 3s linear infinite;
    }
    @keyframes bg-scroll {
      0% { background-position: 0 0; }
      100% { background-position: 40px 40px; }
    }
    
    /* Main content box */
    main {
      background: #c0c0c0;
      border: 4px outset #fff;
      padding: 30px;
      max-width: 600px;
      margin: 0 auto;
    }
    
    h1 {
      color: #ff00ff;
      font-size: 2em;
      text-shadow: 2px 2px 0 #000;
      margin: 0 0 20px 0;
    }
    
    p {
      font-size: 1em;
      line-height: 1.6;
      margin: 10px 0;
    }
    
    a {
      color: #00f;
      text-decoration: underline;
    }
    
    .box {
      background: #fff;
      border: 2px inset #999;
      padding: 15px;
      margin: 15px 0;
    }
    
    code {
      background: #ff0;
      padding: 2px 6px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <main>
    <h1>🌐 Welcome to ~${username}!</h1>
    
    <p><strong>You're live on the web!</strong> This is your starter page. Download it, edit it, make it yours.</p>
    
    <div class="box">
      <p><strong>✏️ How to edit:</strong></p>
      <p>1. Go to <a href="https://public.monster/filemanager">File Manager</a><br>
      2. Download <code>index.html</code><br>
      3. Edit it with any text editor<br>
      4. Upload it back</p>
    </div>
    
    <div class="box">
      <p><strong>💡 Tips:</strong></p>
      <p>• View source (right-click → View Page Source) to see how this works<br>
      • HTML is just text with tags like <code>&lt;p&gt;</code> and <code>&lt;a&gt;</code><br>
      • Check the <a href="https://public.monster/faq">FAQ</a> for help with links and images</p>
    </div>
    
    <p>🚧 <em>Under construction since ${new Date().getFullYear()}</em> 🚧</p>
    
    <p><a href="https://public.monster">← public.monster</a></p>
  </main>
</body>
</html>`;

        try {
          // Update ETag first
          const etagValue = Bun.hash(userid + Date.now());
          const etagUrl = `${BUNNY_STORAGE_URL}/!${userid}/etag`;
          await fetch(etagUrl, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: etagValue.toString() });
          
          // Upload starter page
          const url = `${BUNNY_STORAGE_URL}/~${username}/index.html`;
          const res = await fetch(url, { method: "PUT", headers: { AccessKey: BUNNY_API_KEY }, body: starterHTML });
          if (!res.ok) throw new Error("Upload failed");
          
          return new Response("OK");
        } catch (err) {
          return new Response("Failed to create starter page", { status: 500 });
        }
      }
    },
    "/social-card.png": () => {
      const file = Bun.file("social-card.png");
      return new Response(file, { headers: { "Content-Type": "image/png" } });
    },
    "/about": () => {
      const file = Bun.file("about.html");
      return new Response(file, { headers: { "Content-Type": "text/html" } });
    },
    "/faq": () => {
      const file = Bun.file("faq.html");
      return new Response(file, { headers: { "Content-Type": "text/html" } });
    },
    "/filemanager": async () => {
      const html = await Bun.file("filemanager.html").text();
      const withEnv = html.replace('HANKO_API_URL_PLACEHOLDER', HANKO_API_URL || '');
      return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
    },
    "/profile": async () => {
      const html = await Bun.file("profile.html").text();
      const withEnv = html.replace('HANKO_API_URL_PLACEHOLDER', HANKO_API_URL || '');
      return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
    },
    "/": async req => {
      const html = await Bun.file("index.html").text();
      const withEnv = html.replace('HANKO_API_URL_PLACEHOLDER', HANKO_API_URL || '');
      return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
    }
  },
  async fetch(req) {
    const html = await Bun.file("404.html").text();
    const withEnv = html.replace('HANKO_API_URL_PLACEHOLDER', HANKO_API_URL || '');
    return new Response(withEnv, { status: 404, headers: { "Content-Type": "text/html" } });
  }
});
