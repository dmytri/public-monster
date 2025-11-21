/// <reference types="bun-types" />

export async function serveStaticPage(pageName: string, HANKO_API_URL: string): Promise<Response> {
  // Map page names to file paths
  const pageMap: Record<string, string> = {
    '/': './public/index.html',
    '/about': './public/about.html',
    '/faq': './public/faq.html',
    '/public_html': './public/filemanager.html',
    '/profile': './public/profile.html',
    '/tos': './public/tos.html',
    '/privacy-policy': './public/privacy-policy.html',
    '/content-moderation': './public/content-moderation.html',
  };

  const filePath = pageMap[pageName];
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }

  const file = Bun.file(filePath);
  if (!await file.exists()) {
    return new Response("Not found", { status: 404 });
  }
  const html = await file.text();
  const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
  return new Response(withEnv, { headers: { "Content-Type": "text/html" } });
}

export async function serve404Page(HANKO_API_URL: string): Promise<Response> {
  const file = Bun.file("./public/404.html");
  if (!await file.exists()) {
    return new Response("Page not found", { status: 404 });
  }
  const html = await file.text();
  const withEnv = html.replace(/HANKO_API_URL_PLACEHOLDER/g, HANKO_API_URL || '');
  return new Response(withEnv, { status: 404, headers: { "Content-Type": "text/html" } });
}

export async function serveSocialCard(): Promise<Response> {
  const file = Bun.file("./public/social-card.png");
  if (!await file.exists()) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(file, { headers: { "Content-Type": "image/png" } });
}

// User file serving
export async function serveUserFile(pathname: string, BUNNY_PULL_ZONE: string, BUNNY_STORAGE_URL: string, BUNNY_API_KEY: string) {
  const cdnUrl = `${BUNNY_PULL_ZONE}${pathname}`;
  console.log('SERVER', `${new URL(cdnUrl).protocol}//${new URL(cdnUrl).hostname}`);
  if (BUNNY_PULL_ZONE && BUNNY_PULL_ZONE !== `${new URL(cdnUrl).protocol}//${new URL(cdnUrl).hostname}`) {
    return Response.redirect(cdnUrl, 303);
  }
  return new Response("Not found", { status: 404 });
}
