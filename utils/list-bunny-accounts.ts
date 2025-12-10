
import { ArachnidShield } from "../vendor/arachnid-shield-sdk/src/index";
import { parseArgs } from "util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Define command-line arguments
const argsConfig = {
  'list-users': { type: 'boolean' },
  'violations-only': { type: 'boolean' },
  'user': { type: 'string' },
  'help': { type: 'boolean' },
  'verbose': { type: 'boolean' },
  'shield': { type: 'boolean' },
  'safeguard': { type: 'boolean' },
  'guard': { type: 'boolean' },
  'console-depth': { type: 'string' }
};

// Pre-check for help to show help before parsing other arguments
if (Bun.argv.includes('--help')) {
  console.log(`
Content Safety Scanner for public.monster

Usage: bun run run [options]

Options:
  --help              Show this help message
  --list-users        Just list the discovered users without scanning content
  --violations-only   Only output files that have violations detected
  --user <username>   Specify a particular user to scan (e.g., --user ~username)
                      If not specified, will scan all users
  --verbose           Show complete API responses and detailed information
  --shield            Only run Arachnid Shield scans (images, videos, archives)
  --safeguard         Only run GPT-OSS-Safeguard scans (text-based files)
  --guard             Only run Llama Guard scans (text files and images)
  --console-depth     Set the depth for console object inspection (Bun runtime flag)

Examples:
  bun run run --list-users           # List all users
  bun run run --user ~username       # Scan a specific user
  bun run run --violations-only      # Show only violations
  bun run run --user ~username --violations-only # Scan specific user and show only violations
  bun run run --verbose              # Show detailed API responses
  bun run run --shield               # Run only shield scans
  bun run run --safeguard            # Run only safeguard scans
      `);
  process.exit(0);
}

// Parse the arguments normally - let it fail organically if there are issues
const { values: args } = parseArgs({ args: Bun.argv.slice(2), options: argsConfig, strict: true });

// Determine which scans to run based on arguments
// If no specific scan flags are given, run everything. Otherwise, only run the flags that are explicitly enabled.
const anyScanFlags = args.shield || args.safeguard || args.guard;
const runShieldScan = !anyScanFlags || args.shield;
const runSafeguardScan = !anyScanFlags || args.safeguard;
const runLlamaGuardScan = !anyScanFlags || args.guard;

// Read environment variables
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;

// Arachnid API credentials
const ARACHNID_API_USERNAME = process.env.ARACHNID_API_USERNAME;
const ARACHNID_API_PASSWORD = process.env.ARACHNID_API_PASSWORD;

// Groq API credentials
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_BASE_URL = process.env.GROQ_API_BASE_URL;

// Extract storage zone name from the URL
const STORAGE_ZONE_NAME = BUNNY_STORAGE_URL ? new URL(BUNNY_STORAGE_URL).pathname.split('/').pop() : undefined;

// Function to moderate content with GPT OSS Safeguard 20B model
async function moderateContentWithSafeguard(content: string, reporter: any): Promise<boolean> {
  if (!GROQ_API_KEY || !GROQ_API_BASE_URL) {
    throw new Error('GROQ_API_KEY and/or GROQ_API_BASE_URL are not set in environment variables');
  }

  // Define the content moderation policy as per the content-moderation.html
  // Using the format recommended for GPT-OSS-Safeguard 20B based on documentation
  const policyDescription = `
    You are a content safety evaluator for public.monster. Your task is to identify specific types of harmful content.

    CRITERIA FOR CONCERNING CONTENT (respond with the exact phrase "CONCERNING CONTENT IDENTIFIED"):
    1. Child Sexual Abuse Material (CSAM)
    2. Malicious code (miners, viruses, phishing)
    3. Direct personal harm (doxxing, harassment, non-consensual intimate images)
    4. Hate speech (targeting race, gender identity)
    5. Explicit illegal activity

    If the content contains any of these, respond with: "CONCERNING CONTENT IDENTIFIED"
    For all other content, respond with: "NO CONCERNS IDENTIFIED"

    Content to evaluate:`;

  if (!content) {
    return false;
  }

  // Simple content chunking
  const maxChunkSize = 28000;
  let contentChunks = [];

  if (content.length <= maxChunkSize) {
    contentChunks = [content];
  } else {
    // Split content preserving HTML tags
    if (content.includes('<') && content.includes('>')) {
      const tagBoundaries = /(<\/\w+>)/g;
      let segments = [];
      let lastIndex = 0;
      let match;
      let currentChunk = '';

      while ((match = tagBoundaries.exec(content)) !== null) {
        const segment = content.substring(lastIndex, match.index + match[0].length);

        if ((currentChunk + segment).length > maxChunkSize && currentChunk !== '') {
          segments.push(currentChunk);
          currentChunk = segment;
        } else {
          currentChunk += segment;
        }

        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < content.length) {
        const remaining = content.substring(lastIndex);
        if ((currentChunk + remaining).length <= maxChunkSize) {
          currentChunk += remaining;
        } else {
          if (currentChunk !== '') {
            segments.push(currentChunk);
          }
          if (remaining.length > maxChunkSize) {
            for (let i = 0; i < remaining.length; i += maxChunkSize) {
              segments.push(remaining.substring(i, i + maxChunkSize));
            }
          } else {
            segments.push(remaining);
          }
          currentChunk = '';
        }
      }

      if (currentChunk.trim() !== '') {
        segments.push(currentChunk);
      }

      contentChunks = segments;
    } else {
      // For non-HTML content
      const paragraphs = content.split(/(?:\r?\n\s*){2,}/);
      let currentChunk = '';

      for (const paragraph of paragraphs) {
        if ((currentChunk + paragraph).length > maxChunkSize && currentChunk !== '') {
          contentChunks.push(currentChunk);
          currentChunk = paragraph;
        } else {
          currentChunk += paragraph;
        }
      }

      if (currentChunk.trim() !== '') {
        contentChunks.push(currentChunk);
      }
    }
  }

  let hasViolation = false;

  for (let i = 0; i < contentChunks.length; i++) {
    const chunk = contentChunks[i];

    reporter.verboseInfo(`        API Request [chunk ${i+1}/${contentChunks.length}]: model=openai/gpt-oss-safeguard-20b, content_length=${chunk.length}`);

    const requestBody = {
      model: 'openai/gpt-oss-safeguard-20b',
      messages: [
        {
          role: 'system',
          content: policyDescription
        },
        {
          role: 'user',
          content: `${chunk}`
        }
      ],
      temperature: 0,
      max_tokens: 1024,
      stream: false
    };

    const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    if (response.status !== 200) {
      reporter.verboseInfo(`        API Response [chunk ${i+1}/${contentChunks.length}]: status=${response.status}`);
    }

    if (response.status === 429) { // Rate limit
      const errorDetails = await response.text();

      reporter.verboseInfo(`        Rate Limit Response: ${errorDetails}`);

      // Extract wait time from the error message
      let waitTime = 10000; // Default wait time
      try {
        const errorObj = JSON.parse(errorDetails);
        if (errorObj.error?.message) {
          // Look for the wait time in the error message (e.g., "try again in 4.803999999s")
          const match = errorObj.error.message.match(/try again in (\d+\.?\d*)s/);
          if (match) {
            const apiWaitTime = parseFloat(match[1]);
            waitTime = Math.ceil(apiWaitTime * 1000) + 5000; // API wait time + 5 seconds
          }
        }
      } catch (e) {
        // If parsing fails, use the default wait time
      }

      reporter.verboseInfo(`        Waiting ${waitTime/1000}s (API suggested + 5s) due to rate limit...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Retry once after the wait period
      const retryResponse = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify(requestBody)
      });

      if (retryResponse.status !== 200) {
        reporter.verboseInfo(`        Retry failed with status ${retryResponse.status}`);
        continue;
      }

      const retryData = await retryResponse.json();
      const retryResult = retryData.choices?.[0]?.message?.content?.trim() || '';

      // Process the retry result using the API's actual response
      if (retryResult.includes("CONCERNING CONTENT IDENTIFIED")) {
        hasViolation = true;
        reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length}:\n${retryResult}`);
      } else if (retryResult.includes("NO CONCERNS IDENTIFIED")) {
        reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length}:\n${retryResult}`);
      } else {
        const isViolation = retryResult.toLowerCase().includes('concerning') ||
                           retryResult.toLowerCase().includes('violation') ||
                           retryResult.toLowerCase().includes('harmful');
        if (isViolation) {
          hasViolation = true;
        }
        reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length}:\n${retryResult}`);
      }

      continue;
    }

    if (!response.ok) {
      reporter.verboseInfo(`        API request failed with status ${response.status}`);
      continue;
    }

    const data = await response.json();

    reporter.verboseInfo(`        API Response [chunk ${i+1}/${contentChunks.length}]: has_choices=${!!data.choices}, choice_count=${data.choices?.length || 0}`);

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      reporter.verboseInfo(`        Unexpected response format for chunk ${i+1}: ${reporter.jsonString(data)}`);
      continue;
    }

    const result = data.choices[0]?.message?.content?.trim() || '';

    if (result) {
      reporter.verboseInfo(`        API Result [chunk ${i+1}/${contentChunks.length}]:\n${result}`);
    } else {
      reporter.verboseInfo(`        API Result [chunk ${i+1}/${contentChunks.length}]: Content is empty. Full choice object:`);
      reporter.verboseInfo(reporter.jsonString(data.choices[0]));
    }

    if (!result) {
      // Treat empty response as OK, not a violation.
      reporter.verboseInfo(`        Empty response from API for chunk ${i+1}, treating as OK.`);
      continue;
    }

    // Use the API's actual response rather than our interpretations
    const isViolation = result.includes("CONCERNING CONTENT IDENTIFIED");

    if (isViolation) {
      hasViolation = true;
      reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length} Analysis:\n${reporter.jsonString(data.choices[0])}`);
    } else if (result.includes("NO CONCERNS IDENTIFIED")) {
      reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length}:\n${result}`);
    } else {
      // Fallback check for cases where the model might not use the exact phrase
      const isImplicitViolation = result.toLowerCase().includes('concerning') ||
                                  result.toLowerCase().includes('violation') ||
                                  result.toLowerCase().includes('harmful');
      if (isImplicitViolation) {
        hasViolation = true;
        reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length} Analysis:\n${reporter.jsonString(data.choices[0])}`);
      } else {
        reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length}:\n${result}`);
      }
    }
  }

  reporter.verboseInfo(`        Content analysis completed with ${contentChunks.length} chunk(s). Violation: ${hasViolation}`);

  return hasViolation;
}

// Function to moderate content with Llama Guard 4 12B model (for text and images)
async function moderateWithLlamaGuard(content: string, isImageUrl: boolean, reporter: any): Promise<{ hasViolation: boolean, result: string }> {
  if (!GROQ_API_KEY || !GROQ_API_BASE_URL) {
    throw new Error('GROQ_API_KEY and/or GROQ_API_BASE_URL are not set in environment variables');
  }

  const llamaGuardPolicy = `
    You are a content safety expert. Your task is to classify content as 'safe' or 'unsafe'.

    CATEGORIES OF UNSAFE CONTENT:
    O1: Violent Content (e.g., descriptions of physical harm, fighting)
    O2: Hate Speech (e.g., derogatory terms, discrimination based on protected characteristics)
    O3: Sexual Content (e.g., explicit descriptions, non-consensual intimate imagery)
    O4: Self-Harm (e.g., promotion of self-mutilation, suicide ideation)
    O5: Illegal Activities (e.g., drug manufacturing, illegal weapons, child exploitation)

    If content falls into any UNSAFE category, respond with: "UNSAFE: [CATEGORY_CODE]"
    If content is SAFE, respond with: "SAFE"

    Content to evaluate:`;

  if (!content) {
    return { hasViolation: false, result: "SAFE (empty content)" };
  }

  const contentToModerate = isImageUrl ? `Image URL: ${content}` : content;

  const requestBody = {
    model: 'meta-llama/llama-guard-4-12b',
    messages: [
      {
        role: 'system',
        content: llamaGuardPolicy
      },
      {
        role: 'user',
        content: contentToModerate
      }
    ],
    temperature: 0,
    max_tokens: 200, // Llama Guard responses should be short (SAFE or UNSAFE: O#)
    stream: false
  };

  try {
    reporter.verboseInfo(`        Llama Guard API Request: model=meta-llama/llama-guard-4-12b, content_length=${contentToModerate.length}, is_image=${isImageUrl}`);

    const response = await fetch(`${GROQ_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    if (!response.ok) {
      const errorResult = `Request failed with status ${response.status}: ${reporter.jsonString(data)}`;
      reporter.error("Llama Guard API", errorResult);
      return { hasViolation: true, result: `API Error: ${errorResult}` };
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      const errorResult = `Unexpected Llama Guard response format: ${reporter.jsonString(data)}`;
      reporter.verboseInfo(`        ${errorResult}`);
      return { hasViolation: true, result: `API Format Error: ${errorResult}` };
    }

    const result = data.choices[0]?.message?.content?.trim() || '';
    reporter.verboseInfo(`        Llama Guard API Result:\n${result}`);

    const isUnsafe = result.startsWith("UNSAFE");
    return { hasViolation: isUnsafe, result: isUnsafe ? result : "SAFE" };

  } catch (error: any) {
    reporter.error("Llama Guard API", error);
    return { hasViolation: true, result: `Exception during API call: ${error.message || error}` };
  }
}

// Define TypeScript interface for the response (matches server API response)
interface StorageObject {
  ObjectName: string;  // Using the exact property name from server API
  Length: number;
  LastChanged: string;
  IsDirectory: boolean;
}

// Function to scan an image with Arachnid Shield SDK using URL
async function scanImageWithArachnidShieldFromUrl(fileUrl: string, reporter: any): Promise<any> {
  // Create an instance of ArachnidShield with the API credentials
  // Using default base URL for Arachnid Shield
  const shield = new ArachnidShield(ARACHNID_API_USERNAME, ARACHNID_API_PASSWORD);

  // Perform the scan using the SDK
  reporter.verboseInfo(`        Pinging Arachnid Shield API for: ${fileUrl}`);
  const result = await shield.scanMediaFromUrl(fileUrl);
  reporter.verboseInfo(`        Arachnid Shield API raw response:\n${reporter.jsonString(result)}`);

  return result;
}

// Function to build a properly encoded URL for a file path
function buildFileUrl(objectName: string): string {
  // Use encodeURI which is designed for full URIs and handles spaces properly (as %20)
  return `${BUNNY_PULL_ZONE}${encodeURI(objectName)}`;
}

// Function to compute the MD4 hash of a string using Bun's CryptoHasher
function computeContentHash(content: string): string {
  const hasher = new Bun.CryptoHasher("md4");
  hasher.update(content);
  return hasher.digest("hex");
}

// Function to check if a cached scan result exists for a given content hash and model
function checkCachedScan(hash: string, model: string): boolean {
  const cacheDir = `!moderation/.cache/`;
  const cacheFilePath = join(cacheDir, `${hash}.${model}`);

  // Ensure the cache directory exists
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  return existsSync(cacheFilePath);
}

// Function to save a scan result to cache
function saveScanToCache(hash: string, model: string): void {
  const cacheDir = `!moderation/.cache/`;
  const cacheFilePath = join(cacheDir, `${hash}.${model}`);

  // Ensure the cache directory exists
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }

  // Create an empty file to mark this content as safe for this model
  Bun.write(cacheFilePath, "");
}

// Function to fetch file content from Bunny storage using the storage API
async function fetchFileContent(objectName: string): Promise<string> {
  try {
    // Use the storage API directly instead of the pull zone to avoid URL encoding issues
    const storageUrl = `${BUNNY_STORAGE_URL}${objectName}`;
    const response = await fetch(storageUrl, {
      headers: {
        AccessKey: BUNNY_API_KEY
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch file via storage API: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`Error fetching file content from ${BUNNY_STORAGE_URL}${objectName} via storage API:`, error);
    throw error;
  }
}


async function listStorageObjects(path: string = ""): Promise<StorageObject[]> {
  try {
    // Use the Bunny Storage API directly, similar to how the server does it
    const url = `${BUNNY_STORAGE_URL}${path}`;
    const response = await fetch(url, {
      headers: {
        AccessKey: BUNNY_API_KEY
      }
    });

    if (!response.ok) {
      console.error(`API request failed for path "${path}" with status ${response.status}`);
      return [];
    }

    const items: StorageObject[] = await response.json();
    return items;
  } catch (error) {
    console.error(`Error listing objects in path "${path}":`, error);
    return [];
  }
}

// Function to recursively get all objects in a path
async function getAllObjectsRecursively(path: string = "/", depth: number = 0, maxDepth: number = 10): Promise<StorageObject[]> {
  // Prevent infinite recursion
  if (depth > maxDepth) {
    console.warn(`Max depth (${maxDepth}) reached for path: ${path}`);
    return [];
  }

  const url = `${BUNNY_STORAGE_URL}${path}`;
  const res = await fetch(url, { headers: { AccessKey: BUNNY_API_KEY } });
  if (!res.ok) return [];

  const items = await res.json();
  let allFiles: StorageObject[] = [];

  for (const item of items) {
    if (item.IsDirectory) {
      const subFiles = await getAllObjectsRecursively(`${path}${item.ObjectName}/`, depth + 1, maxDepth);
      allFiles = allFiles.concat(subFiles);
    } else {
      allFiles.push({
        ObjectName: `${path}${item.ObjectName}`,
        Length: item.Length,
        LastChanged: item.LastChanged,
        IsDirectory: item.IsDirectory
      });
    }
  }

  return allFiles;
}

// Run the main function
async function main() {
  // Handle the --help argument first
  if (args.help) {
    console.log(`
Content Safety Scanner for public.monster

Usage: bun run run [options]

Options:
  --help              Show this help message
  --list-users        Just list the discovered users without scanning content
  --violations-only   Only output files that have violations detected
  --user <username>   Specify a particular user to scan (e.g., --user ~username)
                      If not specified, will scan all users

Examples:
  bun run run --list-users           # List all users
  bun run run --user ~username       # Scan a specific user
  bun run run --violations-only      # Show only violations
  bun run run --user ~username --violations-only # Scan specific user and show only violations
    `);
    return; // Exit after showing help
  }

  // Handle the --list-users argument next
  if (args['list-users']) {
    console.log(`Fetching contents of storage zone: ${STORAGE_ZONE_NAME}\n`);

    // Get the top-level directories (potential username folders)
    const topLevelUrl = `${BUNNY_STORAGE_URL}/`;
    const topLevelRes = await fetch(topLevelUrl, {
      headers: {
        AccessKey: BUNNY_API_KEY
      }
    });

    if (!topLevelRes.ok) {
      console.error(`Failed to fetch top-level directories: ${topLevelRes.status} ${topLevelRes.statusText}`);
      return;
    }

    const topLevelItems = await topLevelRes.json();

    // Filter for directories that start with ~ (username folders)
    const usernameFolders = topLevelItems.filter((item: any) =>
      item.IsDirectory && item.ObjectName.startsWith('~')
    );

    console.log("Username Folders (Directories):");
    console.log("===============================");
    for (const dir of usernameFolders) {
      console.log(`. ${dir.ObjectName}/`);
    }
    return; // Exit after listing users
  }

  // Configure console depth based on various settings
  // Priority: --console-depth argument > Bun's console depth setting > default, with verbose mode adjustment
  const bunConsoleDepth = (globalThis as any).Bun?.consoleDepth || (globalThis as any).console?.depth || 2;
  const argConsoleDepth = args['console-depth'] !== undefined ? parseInt(args['console-depth']) : null;
  const baseConsoleDepth = argConsoleDepth !== null ? argConsoleDepth : bunConsoleDepth;
  const adjustedConsoleDepth = args.verbose ? Math.max(baseConsoleDepth, 8) : baseConsoleDepth;

  // Create a dedicated reporter object to handle all console output cleanly.
  // This centralizes the logic for verbose and violations-only modes.
  const reporter = {
    verbose: args.verbose,
    violationsOnly: args['violations-only'],
    depth: adjustedConsoleDepth, // Use console depth from Bun, argument, or default, adjusted for verbose mode

    // Reports a successful scan (no violation).
    ok(file: string, scanner: string) {
      if (this.violationsOnly) return; // In violations-only mode, successful scans are silent.

      const message = this.verbose
        ? `        Status: No violation detected by ${scanner}`
        : `  ${file}: ${scanner} OK`;
      console.log(message);
    },

    // Reports a detected violation.
    violation(file: string, scanner: string, details?: string) {
      const baseMessage = this.verbose
        ? `        Status: ${scanner} VIOLATION DETECTED`
        : `  ${file}: ${scanner} VIOLATION DETECTED`;

      console.log(baseMessage);
      if (this.verbose && details) {
        console.log(`        Details: ${details}`);
      }
    },

    // Reports general information, respecting output rules.
    info(message: string) {
      // Info is only shown if not in violations-only mode.
      if (!this.violationsOnly) {
        console.log(message);
      }
    },

    // Reports verbose-only information.
    verboseInfo(message: string) {
      if (this.verbose) {
        console.log(message);
      }
    },

    // Provides JSON string representation with configurable depth
    jsonString(obj: any): string {
      return JSON.stringify(obj, null, this.depth);
    },

    // Reports an error for a specific file.
    error(file: string, error: any) {
      console.error(`        Error scanning ${file}:`, error);
    }
  };

  // Apply console depth setting
  (console as any).depth = adjustedConsoleDepth;

  console.log(`Fetching contents of storage zone: ${STORAGE_ZONE_NAME}\n`);

  // Get the top-level directories (potential username folders)
  const topLevelUrl = `${BUNNY_STORAGE_URL}/`;
  const topLevelRes = await fetch(topLevelUrl, {
    headers: {
      AccessKey: BUNNY_API_KEY
    }
  });

  if (!topLevelRes.ok) {
    console.error(`Failed to fetch top-level directories: ${topLevelRes.status} ${topLevelRes.statusText}`);
    return;
  }

  const topLevelItems = await topLevelRes.json();

  // Filter for directories that start with ~ (username folders)
  let usernameFolders = topLevelItems.filter((item: any) =>
    item.IsDirectory && item.ObjectName.startsWith('~')
  );

  // If a specific user was requested, filter the list to only that user
  if (args.user) {
    const requestedUser = args.user.startsWith('~') ? args.user : `~${args.user}`;
    usernameFolders = usernameFolders.filter((dir: any) => dir.ObjectName === requestedUser);

    if (usernameFolders.length === 0) {
      console.log(`User ${requestedUser} not found.`);
      return;
    }
  }

  if (usernameFolders.length > 0) {
    console.log("Username Folders (Directories):");
    console.log("===============================");
    for (const dir of usernameFolders) {
      console.log(`. ${dir.ObjectName}/`);

      // Get objects in each username folder (recursively)
      const folderObjects = await getAllObjectsRecursively(`/${dir.ObjectName}/`);

      // Filter for all allowed file types as per server config
      const allowedFiles = folderObjects.filter(obj =>
        !obj.IsDirectory &&
        (obj.ObjectName.toLowerCase().endsWith('.html') ||
         obj.ObjectName.toLowerCase().endsWith('.htm') ||
         obj.ObjectName.toLowerCase().endsWith('.shtml') ||
         obj.ObjectName.toLowerCase().endsWith('.shtm') ||
         obj.ObjectName.toLowerCase().endsWith('.xhtml') ||
         obj.ObjectName.toLowerCase().endsWith('.xht') ||
         obj.ObjectName.toLowerCase().endsWith('.css') ||
         obj.ObjectName.toLowerCase().endsWith('.js') ||
         obj.ObjectName.toLowerCase().endsWith('.mjs') ||
         obj.ObjectName.toLowerCase().endsWith('.md') ||
         obj.ObjectName.toLowerCase().endsWith('.mdx') ||
         obj.ObjectName.toLowerCase().endsWith('.jsx') ||
         obj.ObjectName.toLowerCase().endsWith('.riot') ||
         obj.ObjectName.toLowerCase().endsWith('.tag') ||
         obj.ObjectName.toLowerCase().endsWith('.woff') ||
         obj.ObjectName.toLowerCase().endsWith('.woff2') ||
         obj.ObjectName.toLowerCase().endsWith('.ttf') ||
         obj.ObjectName.toLowerCase().endsWith('.otf') ||
         obj.ObjectName.toLowerCase().endsWith('.png') ||
         obj.ObjectName.toLowerCase().endsWith('.jpg') ||
         obj.ObjectName.toLowerCase().endsWith('.jpeg') ||
         obj.ObjectName.toLowerCase().endsWith('.gif') ||
         obj.ObjectName.toLowerCase().endsWith('.webp') ||
         obj.ObjectName.toLowerCase().endsWith('.svg') ||
         obj.ObjectName.toLowerCase().endsWith('.svgz') ||
         obj.ObjectName.toLowerCase().endsWith('.ico') ||
         obj.ObjectName.toLowerCase().endsWith('.avif') ||
         obj.ObjectName.toLowerCase().endsWith('.heic') ||
         obj.ObjectName.toLowerCase().endsWith('.heif') ||
         obj.ObjectName.toLowerCase().endsWith('.bmp') ||
         obj.ObjectName.toLowerCase().endsWith('.tiff') ||
         obj.ObjectName.toLowerCase().endsWith('.tif') ||
         obj.ObjectName.toLowerCase().endsWith('.mp4') ||
         obj.ObjectName.toLowerCase().endsWith('.webm') ||
         obj.ObjectName.toLowerCase().endsWith('.mp3') ||
         obj.ObjectName.toLowerCase().endsWith('.wav') ||
         obj.ObjectName.toLowerCase().endsWith('.mid') ||
         obj.ObjectName.toLowerCase().endsWith('.midi') ||
         obj.ObjectName.toLowerCase().endsWith('.ogg') ||
         obj.ObjectName.toLowerCase().endsWith('.ogv') ||
         obj.ObjectName.toLowerCase().endsWith('.mov') ||
         obj.ObjectName.toLowerCase().endsWith('.qt') ||
         obj.ObjectName.toLowerCase().endsWith('.glb') ||
         obj.ObjectName.toLowerCase().endsWith('.gltf') ||
         obj.ObjectName.toLowerCase().endsWith('.txt') ||
         obj.ObjectName.toLowerCase().endsWith('.json') ||
         obj.ObjectName.toLowerCase().endsWith('.xml') ||
         obj.ObjectName.toLowerCase().endsWith('.csv') ||
         obj.ObjectName.toLowerCase().endsWith('.tsv') ||
         obj.ObjectName.toLowerCase().endsWith('.yaml') ||
         obj.ObjectName.toLowerCase().endsWith('.yml') ||
         obj.ObjectName.toLowerCase().endsWith('.ini') ||
         obj.ObjectName.toLowerCase().endsWith('.conf') ||
         obj.ObjectName.toLowerCase().endsWith('.properties') ||
         obj.ObjectName.toLowerCase().endsWith('.env') ||
         obj.ObjectName.toLowerCase().endsWith('.rss') ||
         obj.ObjectName.toLowerCase().endsWith('.atom') ||
         obj.ObjectName.toLowerCase().endsWith('.rdf') ||
         obj.ObjectName.toLowerCase().endsWith('.zip') ||
         obj.ObjectName.toLowerCase().endsWith('.tar') ||
         obj.ObjectName.toLowerCase().endsWith('.tgz') ||
         obj.ObjectName.toLowerCase().endsWith('.gz') ||
         obj.ObjectName.toLowerCase().endsWith('.bz2') ||
         obj.ObjectName.toLowerCase().endsWith('.xz') ||
         obj.ObjectName.toLowerCase().endsWith('.7z') ||
         obj.ObjectName.toLowerCase().endsWith('.pdf') ||
         obj.ObjectName.toLowerCase().endsWith('.webmanifest') ||
         obj.ObjectName.toLowerCase().endsWith('.map'))
      );

      // Filter for image/video files to scan with Arachnid Shield
      const shieldFiles = allowedFiles.filter(obj =>
        obj.ObjectName.toLowerCase().endsWith('.png') ||
        obj.ObjectName.toLowerCase().endsWith('.jpg') ||
        obj.ObjectName.toLowerCase().endsWith('.jpeg') ||
        obj.ObjectName.toLowerCase().endsWith('.gif') ||
        obj.ObjectName.toLowerCase().endsWith('.webp') ||
        obj.ObjectName.toLowerCase().endsWith('.bmp') ||
        obj.ObjectName.toLowerCase().endsWith('.tiff') ||
        obj.ObjectName.toLowerCase().endsWith('.tif') ||
        obj.ObjectName.toLowerCase().endsWith('.ico') ||
        obj.ObjectName.toLowerCase().endsWith('.avif') ||
        obj.ObjectName.toLowerCase().endsWith('.heic') ||
        obj.ObjectName.toLowerCase().endsWith('.heif') ||
        obj.ObjectName.toLowerCase().endsWith('.mp4') ||
        obj.ObjectName.toLowerCase().endsWith('.webm') ||
        obj.ObjectName.toLowerCase().endsWith('.mov') ||
        obj.ObjectName.toLowerCase().endsWith('.qt') ||
        obj.ObjectName.toLowerCase().endsWith('.ogv') ||
        obj.ObjectName.toLowerCase().endsWith('.mid') ||
        obj.ObjectName.toLowerCase().endsWith('.midi') ||
        obj.ObjectName.toLowerCase().endsWith('.mp3') ||
        obj.ObjectName.toLowerCase().endsWith('.wav') ||
        obj.ObjectName.toLowerCase().endsWith('.ogg') ||
        obj.ObjectName.toLowerCase().endsWith('.glb') ||
        obj.ObjectName.toLowerCase().endsWith('.gltf')
      );

      // Define shield file extensions (images, videos, audio, 3D models)
      const shieldExtensions = [
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
        '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif',
        '.mp4', '.webm', '.mov', '.qt', '.ogv',
        '.mid', '.midi', '.mp3', '.wav', '.ogg',
        '.glb', '.gltf'
      ];

      // Define text-based file extensions that should be scanned with GPT-OSS-Safeguard
      const textExtensions = [
        '.html', '.htm', '.shtml', '.shtm', '.xhtml', '.xht',
        '.css', '.js', '.mjs', '.md', '.mdx', '.jsx', '.riot', '.tag',
        '.txt', '.json', '.xml', '.csv', '.tsv', '.yaml', '.yml',
        '.ini', '.conf', '.properties', '.env', '.rss', '.atom', '.rdf',
        '.webmanifest', '.map', '.svg'
      ];

      // Define file extensions for Llama Guard (all text + images, no archives/videos)
      const llamaGuardExtensions = [
        '.html', '.htm', '.shtml', '.shtm', '.xhtml', '.xht',
        '.css', '.js', '.mjs', '.md', '.mdx', '.jsx', '.riot', '.tag',
        '.txt', '.json', '.xml', '.csv', '.tsv', '.yaml', '.yml',
        '.ini', '.conf', '.properties', '.env', '.rss', '.atom', '.rdf',
        '.webmanifest', '.map', '.svg',
        '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
        '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif'
      ];

      // Filter for files that should be scanned with Groq (text-based files)
      const groqFiles = allowedFiles.filter(obj => {
        const ext = '.' + obj.ObjectName.toLowerCase().split('.').pop();
        return textExtensions.includes(ext);
      });

      // Filter for files that should be scanned with Llama Guard (text files and images)
      const llamaGuardFiles = allowedFiles.filter(obj => {
        const ext = '.' + obj.ObjectName.toLowerCase().split('.').pop();
        return llamaGuardExtensions.includes(ext);
      });

      reporter.info(`    Total allowed files found: ${allowedFiles.length}`);

      // Scan files that should be scanned with GPT-OSS-Safeguard (text-based files)
      if (runSafeguardScan && groqFiles.length > 0) {
        reporter.info(`    Text-based files found (GPT-OSS-Safeguard): ${groqFiles.length}`);

        for (let i = 0; i < groqFiles.length; i++) {
          const file = groqFiles[i];

          try {
            const fileContent = await fetchFileContent(file.ObjectName);
            const contentHash = computeContentHash(fileContent);

            // Check if this content has already been scanned and found safe by GPT-OSS-Safeguard
            if (checkCachedScan(contentHash, 'safeguard')) {
              reporter.info(`  ${file.ObjectName}: GPT-OSS-SAFEGUARD OK (cached)`);
              // Add a shorter delay for cached files
              if (i < groqFiles.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay for cached
              }
              continue; // Skip scanning since it's already been checked and found safe
            }

            const hasViolation = await moderateContentWithSafeguard(fileContent, reporter);

            if (hasViolation) {
              reporter.violation(file.ObjectName, 'GPT-OSS-SAFEGUARD TEXT');
            } else {
              reporter.ok(file.ObjectName, 'GPT-OSS-SAFEGUARD');
              // Save to cache since the content is safe
              saveScanToCache(contentHash, 'safeguard');
            }

            // Add a delay between file processing to avoid rate limiting
            if (i < groqFiles.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
            }
          } catch (error) {
            reporter.error(file.ObjectName, error);
          }
        }
      } else if (runSafeguardScan) {
        reporter.info("    No text-based files found for GPT-OSS-Safeguard");
      }

      // Scan files with Llama Guard
      if (runLlamaGuardScan && llamaGuardFiles.length > 0) {
        reporter.info(`    Text and image files found (Llama Guard): ${llamaGuardFiles.length}`);

        for (let i = 0; i < llamaGuardFiles.length; i++) {
          const file = llamaGuardFiles[i];

          // Determine if the file is an image based on its extension
          const isImageUrl = shieldExtensions.some(ext => file.ObjectName.toLowerCase().endsWith(ext));

          try {
            let contentForLlamaGuard: string;
            let contentHash: string | null = null;

            if (isImageUrl) {
              // For images, we can still implement caching but will need the image content
              const imageContent = await fetchFileContent(file.ObjectName);
              contentHash = computeContentHash(imageContent);

              // Check if this content has already been scanned and found safe by Llama Guard
              if (checkCachedScan(contentHash, 'guard')) {
                reporter.info(`  ${file.ObjectName}: LLAMA GUARD OK (cached)`);
                // Add a shorter delay for cached files
                if (i < llamaGuardFiles.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay for cached
                }
                continue; // Skip scanning since it's already been checked and found safe
              }

              contentForLlamaGuard = buildFileUrl(file.ObjectName); // For images, pass the URL
            } else {
              const fileContent = await fetchFileContent(file.ObjectName);
              contentHash = computeContentHash(fileContent);

              // Check if this content has already been scanned and found safe by Llama Guard
              if (checkCachedScan(contentHash, 'guard')) {
                reporter.info(`  ${file.ObjectName}: LLAMA GUARD OK (cached)`);
                // Add a shorter delay for cached files
                if (i < llamaGuardFiles.length - 1) {
                  await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay for cached
                }
                continue; // Skip scanning since it's already been checked and found safe
              }

              contentForLlamaGuard = fileContent; // For text, fetch content
            }

            const { hasViolation, result } = await moderateWithLlamaGuard(contentForLlamaGuard, isImageUrl, reporter);

            if (hasViolation) {
              reporter.violation(file.ObjectName, 'LLAMA GUARD', result);
            } else {
              reporter.ok(file.ObjectName, 'LLAMA GUARD');
              // Save to cache since the content is safe (if we have a hash)
              if (contentHash) {
                saveScanToCache(contentHash, 'guard');
              }
            }

            // Add a delay between file processing to avoid rate limiting
            if (i < llamaGuardFiles.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
            }
          } catch (error) {
            reporter.error(file.ObjectName, error);
          }
        }
      } else if (runLlamaGuardScan) {
        reporter.info("    No text or image files found for Llama Guard");
      }

      // Scan files with Arachnid Shield
      if (runShieldScan && shieldFiles.length > 0) {
        reporter.info(`    Media files found: ${shieldFiles.length}`);

        for (const shieldFile of shieldFiles) {
          try {
            // Build the file URL using the buildFileUrl function to handle special characters
            const fileUrl = buildFileUrl(shieldFile.ObjectName);

            // For Arachnid Shield, we use URL-based hashing for the cache instead of content-based hashing
            const urlHash = computeContentHash(fileUrl);

            // Check if this URL has already been scanned and found safe by Arachnid Shield
            if (checkCachedScan(urlHash, 'shield')) {
              reporter.info(`  ${shieldFile.ObjectName}: ARACHNID SHIELD OK (cached)`);
              continue; // Skip scanning since it's already been checked and found safe
            }

            const scanResult = await scanImageWithArachnidShieldFromUrl(fileUrl, reporter);

            if (scanResult.status === 'ok' && scanResult.data.is_match) {
              const classificationDetails = scanResult.data.classification ? `Classification: ${scanResult.data.classification}` : 'No classification provided.';
              reporter.violation(shieldFile.ObjectName, 'ARACHNID SHIELD CSAM', classificationDetails);
            } else if (scanResult.status === 'ok') {
              reporter.ok(shieldFile.ObjectName, 'ARACHNID SHIELD');
              // Save to cache since the content is safe
              saveScanToCache(urlHash, 'shield');
            } else { // status is 'err' (already handled by catch, but good for explicit logic)
              reporter.error(shieldFile.ObjectName, scanResult.data);
            }
          } catch (error) {
            reporter.error(shieldFile.ObjectName, error);
          }
        }
      } else if (runShieldScan) {
        reporter.info("    No media files found");
      }

      reporter.info(""); // Add a blank line for readability between users
    }
  } else {
    console.log("No username folders found.");
  }
}



// Only run main if this file is executed directly (not imported)
if (process.argv[1] === import.meta.path) {
  main();
}
