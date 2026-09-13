/// <reference types="bun-types" />
/* global Bun, process */

declare global {
  var TEST: Readonly<Record<string, string | number | boolean>> | undefined
}

type UserInfo = { userid: string; username: string };

export async function getUserInfo(req: Bun.BunRequest, HANKO_API_URL: string): Promise<UserInfo> {
  if (typeof globalThis.TEST !== 'undefined' && typeof globalThis.TEST.username == 'string')
    return { userid: 'TEST_USERID', username: globalThis.TEST.username };

  let token: string | null = req.cookies.get('hanko');

  if (!token)
    throw new Error('No Auth Token Found');

  const meRes = await fetch(`${HANKO_API_URL}/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!meRes.ok) throw new Error('Failed to fetch user');
  const me = await meRes.json();
  const id = me?.id;
  const username = me?.username?.username;

  if (typeof id !== 'string' || !id)
    throw new Error('Invalid user ID');

  if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(username)) {
    throw new Error('Invalid username')
  }

  return Object.freeze({ userid: id, username });
}

type AuthedHandler = (
  req: Bun.BunRequest,
  user: UserInfo,
) => Promise<Response> | Response;

export function requireAuth(handler: AuthedHandler, HANKO_API_URL: string) {
  return async (req: Bun.BunRequest): Promise<Response> => {
    let user: UserInfo = await getUserInfo(req, HANKO_API_URL);
    return handler(req, user);
  };
}