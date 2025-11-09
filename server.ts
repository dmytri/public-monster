import { serve } from "bun";
import { jwtVerify, createRemoteJWKSet } from "jose";

const HANKO_API_URL = process.env.HANKO_API_URL;
const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

const JWKS = HANKO_API_URL ? createRemoteJWKSet(new URL(`${HANKO_API_URL}/.well-known/jwks.json`)) : null;

// Abuse prevention config
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_EXTENSIONS = [
  // HTML + SSI
  '.html', '.htm',
  '.shtml', '.shtm',

  // XHTML (retro)
  '.xhtml', '.xht',

  // Text / data / source
  '.txt', '.json', '.xml', '.csv', '.tsv',
  '.yaml', '.yml',
  '.ini', '.conf', '.properties', '.env',
  '.md', '.mdx',
  '.jsx',
  '.riot', '.tag',

  // Feeds (retro web)
  '.rss', '.atom',

  // Documents
  '.pdf',

  // Manifests / maps
  '.webmanifest', '.map',

  // JS / CSS
  '.js', '.mjs',
  '.css',

  // Fonts
  '.woff', '.woff2', '.ttf', '.otf',

  // Images
  '.png', '.jpg', '.jpeg', '.gif',
  '.webp', '.svg', '.svgz', '.ico',
  '.avif', '.heic', '.heif',
  '.bmp', '.tiff', '.tif',

  // Media
  '.mp4', '.webm', '.mp3', '.wav',
  '.mid', '.midi',

  // WASM + 3D
  '.wasm',
  '.glb', '.gltf'
];

async function uploadToBunny(targetPath: string, blob: Blob) {
  if (!BUNNY_STORAGE_URL || !BUNNY_API_KEY) throw new Error("Bunny Storage not configured");
  const url = BUNNY_STORAGE_URL + '/' + encodeURI(targetPath);
  const res = await fetch(url, { method:"PUT", headers:{ AccessKey:BUNNY_API_KEY }, body:blob });
  if (!res.ok) throw new Error("Upload failed");
}

serve({
  port: 3000,
  routes: {
    "/~*": req => {
      const url = new URL(req.url);
      const cdnUrl = `${BUNNY_PULL_ZONE}/${url.pathname}`;
      if (BUNNY_PULL_ZONE !== `${url.protocol}${url.hostname}`) {
        return Response.redirect(cdnUrl, 303);
      }
    },
    "/upload": {
      POST: async req => {
        let username: string | null = null;
        const token = req.headers.get("Authorization")?.replace("Bearer ", "");
        if (token && JWKS) {
          try {
            const { payload } = await jwtVerify(token, JWKS);
            username = payload.username as string;
          } catch {
            return new Response("Unauthorized", { status: 401 });
          }
        } else if (JWKS) {
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
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          return new Response("File type not allowed", { status: 403 });
        }

        try {
          await uploadToBunny('~' + username + '/' + path, file);
          return new Response("OK");
        } catch (err) {
          return new Response("Upload failed", { status: 500 });
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
    "/": async req => {
      const html = await Bun.file("index.html").text();
      const withEnv = html.replace('HANKO_API_URL_PLACEHOLDER', HANKO_API_URL || '');
      return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
    }
  },
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  }
});
