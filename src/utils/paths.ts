/// <reference types="bun-types" />
import * as FilePath from 'path';

class InvalidPathError extends Error {}

export { InvalidPathError };

export async function storagePath(username: string, path: string): Promise<string> {
  if (path.startsWith('\\'))
    throw new InvalidPathError('Invalid path');

  if (path.includes('..'))
    throw new InvalidPathError('Invalid path: attempted directory traversal');

  const base = FilePath.posix.resolve(`/~${username}/`);
  const resolvedPath = FilePath.posix.resolve(base, path);

  if (!resolvedPath.startsWith(base))
    throw new InvalidPathError('Invalid path: directory traversal detected');

  return resolvedPath;
}