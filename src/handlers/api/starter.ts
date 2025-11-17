/// <reference types="bun-types" />

type UserInfo = { userid: string; username: string };

export async function createStarterPageHandler(
  req: Bun.BunRequest, 
  user: UserInfo, 
  BUNNY_STORAGE_URL: string, 
  BUNNY_API_KEY: string
): Promise<Response> {
  const { username, userid } = user;

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
}