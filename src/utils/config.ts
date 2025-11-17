/// <reference types="bun-types" />
/* global Bun, process */

import * as FilePath from 'path';

export function validateEnvironmentVariables() {
  const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;
  const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
  const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
  const HANKO_API_URL = process.env.HANKO_API_URL;

  if (!HANKO_API_URL || !BUNNY_STORAGE_URL || !BUNNY_API_KEY) {
    throw new Error("Missing required environment variables: HANKO_API_URL, BUNNY_STORAGE_URL, BUNNY_API_KEY");
  }

  return {
    BUNNY_PULL_ZONE,
    BUNNY_STORAGE_URL,
    BUNNY_API_KEY,
    HANKO_API_URL
  };
}

export const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
export const ALLOWED_EXTENSIONS = [
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