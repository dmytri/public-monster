import { serve } from "bun";
import { jwtVerify, createRemoteJWKSet } from "jose";

const HANKO_API_URL = process.env.HANKO_API_URL;
const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

const JWKS = HANKO_API_URL ? createRemoteJWKSet(new URL(`${HANKO_API_URL}/.well-known/jwks.json`)) : null;

async function uploadToBunny(targetPath: string, blob: Blob) {
  if (!BUNNY_STORAGE_URL || !BUNNY_API_KEY) throw new Error("Bunny Storage not configured");
  const url = BUNNY_STORAGE_URL + '/' + encodeURI(targetPath);
  const res = await fetch(url, { method:"PUT", headers:{ AccessKey:BUNNY_API_KEY }, body:blob });
  if (!res.ok) throw new Error("Upload failed");
}

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname.startsWith("/~")) {
      const parts = url.pathname.slice(2).split("/");
      const username = parts[0];
      const path = parts.slice(1).join("/");
      
      if (!BUNNY_PULL_ZONE) {
        return new Response("CDN not configured", { status: 500 });
      }
      
      const cdnPath = path || "index.html";
      const cdnUrl = `${BUNNY_PULL_ZONE}/~${username}/${cdnPath}`;
      return Response.redirect(cdnUrl, 302);
    }

    if (url.pathname === "/upload" && req.method === "POST") {
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
      } else {
        // demo mode – fallback user
        username = "you";
      }

      const form = await req.formData();
      const file = form.get("file") as File;
      const path = form.get("path") as string;
      if (!file || !path) return new Response("Bad request", { status: 400 });
      
      try {
        await uploadToBunny('~' + username + '/' + path, file);
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
