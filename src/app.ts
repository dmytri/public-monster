/// <reference types="bun-types" />
/* global Bun, process */

import { validateEnvironmentVariables, MAX_FILE_SIZE, ALLOWED_EXTENSIONS } from './utils/config';
import { requireAuth, getUserInfo } from './utils/auth';
import { InvalidPathError } from './utils/paths';
import {
  uploadFileHandler,
  listFilesHandler,
  deleteFileHandler,
  getFileContentHandler,
  validateHtmlHandler,
  getValidationReportHandler
} from './handlers/api/files';
import { createStarterPageHandler } from './handlers/api/starter';
import { prepareMigrationHandler, migrateUsernameHandler } from './handlers/api/migration';
import { downloadZipHandler } from './handlers/api/zip';
import { 
  serveStaticPage, 
  serve404Page, 
  serveSocialCard,
  serveUserFile
} from './handlers/static';

declare global {
  var TEST: Readonly<Record<string, string | number | boolean>> | undefined
}

export function startServer(port: number = 3000, test: Record<string, string | number | boolean> = {}) {
  if (!!Object.keys(test).length) {
    console.log('~ [ TEST MODE ]')
    Object.freeze(test)
    Object.defineProperty(globalThis, "TEST", {
      value: test, writable: false, configurable: false, enumerable: false
    })
  }

  const { BUNNY_PULL_ZONE, BUNNY_STORAGE_URL, BUNNY_API_KEY, HANKO_API_URL } = validateEnvironmentVariables();
  Object.freeze(process.env)

  console.log('~ public.monster')
  return Bun.serve({
    hostname: '0.0.0.0',
    port: port,
    routes: {
      // API: Upload, List, Delete files
      "/api/files": {
        POST: requireAuth(async (req, user) => {
          return uploadFileHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL),
        GET: requireAuth(async (req, user) => {
          return listFilesHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL),
        DELETE: requireAuth(async (req, user) => {
          return deleteFileHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      // API: Create starter page
      "/api/create-starter": {
        POST: requireAuth(async (req, user) => {
          return createStarterPageHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      // API: Get file content
      "/api/files/content/*": {
        GET: requireAuth(async (req, user) => {
          return getFileContentHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      // API: Generic Validation
      "/api/validate": {
        GET: requireAuth(async (req, user) => {
          return validateHtmlHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      // API: Get validation report
      "/api/validation-report": {
        GET: requireAuth(async (req, user) => {
          return getValidationReportHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      // API: Get user info
      "/api/whoami": {
        GET: requireAuth(async (req, user) => {
          return new Response(JSON.stringify({
            userid: user.userid,
            username: user.username
          }), {
            headers: { "Content-Type": "application/json" }
          });
        }, HANKO_API_URL)
      },

      // API: Download all files as zip
      "/api/files/zip": {
        GET: requireAuth(async (req, user) => {
          return downloadZipHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      "/api/prepare-migration": {
        GET: requireAuth(async (req, user) => {
          return prepareMigrationHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      "/api/migrate-username": {
        POST: requireAuth(async (req, user) => {
          return migrateUsernameHandler(req, user, BUNNY_STORAGE_URL, BUNNY_API_KEY);
        }, HANKO_API_URL)
      },

      "/": async () => {
        return serveStaticPage('/', HANKO_API_URL);
      },

      "/about": async () => {
        return serveStaticPage('/about', HANKO_API_URL);
      },

      "/faq": async () => {
        return serveStaticPage('/faq', HANKO_API_URL);
      },

      "/public_html": async () => {
        return serveStaticPage('/public_html', HANKO_API_URL);
      },

      "/profile": async () => {
        return serveStaticPage('/profile', HANKO_API_URL);
      },

      "/tos": async () => {
        return serveStaticPage('/tos', HANKO_API_URL);
      },

      "/privacy-policy": async () => {
        return serveStaticPage('/privacy-policy', HANKO_API_URL);
      },

      "/content-moderation": async () => {
        return serveStaticPage('/content-moderation', HANKO_API_URL);
      },

      "/validate": async () => {
        return serveStaticPage('/validate', HANKO_API_URL);
      },

      "/404": async () => {
        return serve404Page(HANKO_API_URL);
      },

      "/social-card.png": async () => {
        return serveSocialCard();
      },

      // Static assets from node_modules
      "/assets/*": async (req) => {
        const url = new URL(req.url);
        const assetPath = url.pathname.substring(8); // Remove '/assets/'

        // Only allow specific assets for security
        if (!assetPath.startsWith('prismjs/') && !assetPath.startsWith('escape-html/') && !assetPath.startsWith('htmlhint/')) {
          return new Response("Not found", { status: 404 });
        }

        const filePath = `./node_modules/${assetPath}`;
        const file = Bun.file(filePath);

        if (!await file.exists()) {
          return new Response("Not found", { status: 404 });
        }

        // Set content type based on file extension
        let contentType = "application/octet-stream";
        if (filePath.endsWith(".css")) {
          contentType = "text/css";
        } else if (filePath.endsWith(".js")) {
          contentType = "application/javascript";
        }

        return new Response(file, { headers: { "Content-Type": contentType } });
      },
    },

    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.startsWith('/~')) {
        return Response.redirect(`${BUNNY_PULL_ZONE}${url.pathname}`, 303);
      }

      // Check if the requested path is one of our static pages
      if (['/tos', '/privacy-policy', '/content-moderation', '/validate-html'].includes(url.pathname)) {
        return serveStaticPage(url.pathname, HANKO_API_URL);
      }

      return serve404Page(HANKO_API_URL);
    },
    error(err) {
      if (err instanceof InvalidPathError) {
        return new Response("Invalid file path", { status: 400 });
      }
      throw err;
    }
  });
}
