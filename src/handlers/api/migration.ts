/// <reference types="bun-types" />
import { listFilesRecursive } from './files';

type UserInfo = { userid: string; username: string };

export async function prepareMigrationHandler(
  req: Bun.BunRequest, 
  user: UserInfo, 
  BUNNY_STORAGE_URL: string, 
  BUNNY_API_KEY: string
): Promise<Response> {
  const tokenPath = `/~${user.username}/.migration_token`;
  await fetch(`${BUNNY_STORAGE_URL}${tokenPath}`, {
    method: "PUT",
    headers: { AccessKey: BUNNY_API_KEY },
    body: user.userid
  });
  
  return new Response("OK");
}

export async function migrateUsernameHandler(
  req: Bun.BunRequest,
  user: UserInfo,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<Response> {
  const body = await req.json();

  let oldUsername = body.old;
  let newUsername = user.username;

  if (typeof globalThis.TEST !== 'undefined' && typeof globalThis.TEST.username == 'string') {
    oldUsername = newUsername;
    newUsername = oldUsername;
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

    const files = await listFilesRecursive(`/~${oldUsername}/`, oldUsername, BUNNY_STORAGE_URL, BUNNY_API_KEY);

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

      if (globalThis.TEST && typeof globalThis.TEST.username == 'string') {
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
}