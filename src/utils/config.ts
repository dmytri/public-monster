/// <reference types="bun-types" />
/* global Bun, process */

import * as FilePath from 'path';

export function validateEnvironmentVariables() {
  const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;
  const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
  const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
  const HANKO_API_URL = process.env.HANKO_API_URL;
  const ARACHNID_API_USERNAME = process.env.ARACHNID_API_USERNAME;
  const ARACHNID_API_PASSWORD = process.env.ARACHNID_API_PASSWORD;

  if (!HANKO_API_URL || !BUNNY_STORAGE_URL || !BUNNY_API_KEY || !ARACHNID_API_USERNAME || !ARACHNID_API_PASSWORD) {
    throw new Error("Missing required environment variables: HANKO_API_URL, BUNNY_STORAGE_URL, BUNNY_API_KEY, ARACHNID_API_USERNAME, ARACHNID_API_PASSWORD");
  }

  return {
    BUNNY_PULL_ZONE,
    BUNNY_STORAGE_URL,
    BUNNY_API_KEY,
    HANKO_API_URL,
    ARACHNID_API_USERNAME,
    ARACHNID_API_PASSWORD
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

// Shield scannable file extensions (media types for CSAM detection)
export const SHIELD_SCANNABLE_EXTENSIONS = [
  // images
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
  '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif',
  // videos
  '.mp4', '.webm', '.mov', '.qt', '.ogv',
  // audio
  '.mp3', '.wav', '.mid', '.midi', '.ogg',
  // 3D models
  '.glb', '.gltf'
];

export function isShieldScannableFile(filename: string): boolean {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? SHIELD_SCANNABLE_EXTENSIONS.includes(ext) : false;
}