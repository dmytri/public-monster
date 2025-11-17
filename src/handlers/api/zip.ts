/// <reference types="bun-types" />
import { listFilesRecursive } from './files';

type UserInfo = { userid: string; username: string };

export async function downloadZipHandler(
  req: Bun.BunRequest,
  user: UserInfo,
  BUNNY_STORAGE_URL: string,
  BUNNY_API_KEY: string
): Promise<Response> {
  try {
    const files = await listFilesRecursive(`/~${user.username}/`, user.username, BUNNY_STORAGE_URL, BUNNY_API_KEY);

    const proc = Bun.spawn(["sh", "-c", `cd /tmp && mkdir -p ${user.username} && cd ${user.username} && rm -rf *`]);
    await proc.exited;

    for (const file of files) {
      const res = await fetch(`${BUNNY_STORAGE_URL}/~${user.username}/${file.ObjectName}`, { headers: { AccessKey: BUNNY_API_KEY } });
      if (res.ok) {
        const data = await res.arrayBuffer();
        const filePath = `/tmp/${user.username}/${file.ObjectName}`;
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

    const zipProc = Bun.spawn(["sh", "-c", `cd /tmp && zip -r ${user.username}.zip ${user.username}`]);
    await zipProc.exited;
    const stdout = await new Response(zipProc.stdout).text();
    const stderr = await new Response(zipProc.stderr).text();

    const zipFile = Bun.file(`/tmp/${user.username}.zip`);

    return new Response(zipFile, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${user.username}.zip"`
      }
    });
  } catch (err) {
    console.error(err);
    return new Response("Failed to create zip", { status: 500 });
  }
}