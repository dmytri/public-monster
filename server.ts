import { serve } from "bun";
import { jwtVerify, createRemoteJWKSet } from "jose";

const HANKO_API_URL = process.env.HANKO_API_URL;
const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;

const JWKS = HANKO_API_URL ? createRemoteJWKSet(new URL(`${HANKO_API_URL}/.well-known/jwks.json`)) : null;

async function uploadToBunny(targetPath: string, blob: Blob) {
  if (!BUNNY_STORAGE_URL || !BUNNY_API_KEY) throw new Error("Bunny Storage not configured");
  const url = BUNNY_STORAGE_URL + '/' + encodeURI(targetPath);
  const res = await fetch(url, { method:"PUT", headers:{ AccessKey:BUNNY_API_KEY }, body:blob });
  if (!res.ok) throw new Error("Upload failed");
}

async function getFromBunny(targetPath: string) {
  if (!BUNNY_STORAGE_URL || !BUNNY_API_KEY) return null;
  const url = BUNNY_STORAGE_URL + '/' + encodeURI(targetPath);
  const res = await fetch(url, { headers:{ AccessKey:BUNNY_API_KEY } });
  if (!res.ok) return null;
  return res;
}

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/~")) {
      const parts = url.pathname.slice(2).split("/");
      const username = parts[0];
      const path = parts.slice(1);
      if (path.length === 0 && !url.pathname.endsWith('/')) {
        return Response.redirect(url.pathname + '/', 301);
      }
      const filePath = path.join("/") || "index.html";

      const res = await getFromBunny(username + '/' + filePath);
      if (res) {
        const ext = filePath.split('.').pop();
        const types: Record<string, string> = {css:'text/css',js:'application/javascript',png:'image/png',jpg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',html:'text/html',txt:'text/plain'};
        return new Response(res.body, { headers: { 'Content-Type': types[ext || ''] || 'application/octet-stream' } });
      }

      return new Response("Not found", { status: 404 });
    }

    if (url.pathname === "/hanko-elements.js") {
      const file = Bun.file("node_modules/@teamhanko/hanko-elements/dist/elements.js");
      return new Response(file, { headers: { "Content-Type": "application/javascript" } });
    }

    if (url.pathname === "/upload" && req.method === "POST") {
      let userId: string | null = null;
      const token = req.headers.get("Authorization")?.replace("Bearer ", "");
      if (token && JWKS) {
        try {
          const { payload } = await jwtVerify(token, JWKS);
          userId = payload.sub!;
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }
      } else if (JWKS) {
        return new Response("Unauthorized", { status: 401 });
      } else {
        // demo mode – fallback user
        userId = "you";
      }

      const form = await req.formData();
      const file = form.get("file") as File;
      const path = form.get("path") as string;
      if (!file || !path) return new Response("Bad request", { status: 400 });
      
      try {
        await uploadToBunny(userId + '/' + path, file);
        return new Response("OK");
      } catch (err) {
        return new Response("Upload failed", { status: 500 });
      }
    }

    if (url.pathname === "/about") {
      const file = Bun.file("about.html");
      return new Response(file, { headers: { "Content-Type": "text/html" } });
    }

    const html = await Bun.file("index.html").text();
    const withEnv = html.replace('HANKO_API_URL_PLACEHOLDER', HANKO_API_URL || '');
    return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
  }
});
