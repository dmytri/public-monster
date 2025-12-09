
import { ArachnidShield } from "../vendor/arachnid-shield-sdk/src/index";
import { parseArgs } from "util";

// Define command-line arguments
const argsConfig = {
  'list-users': { type: 'boolean' },
  'violations-only': { type: 'boolean' },
  'user': { type: 'string' },
  'help': { type: 'boolean' },
  'verbose': { type: 'boolean' },
  'shield': { type: 'boolean' },
  'safeguard': { type: 'boolean' }
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
// Default to true if no specific scan flags are provided
const hasScanFlags = args.shield !== undefined || args.safeguard !== undefined;
const runShieldScan = hasScanFlags ? args.shield || false : true;
const runSafeguardScan = hasScanFlags ? args.safeguard || false : true;

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
async function moderateContentWithSafeguard(content: string): Promise<boolean> {
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

    if (args.verbose) {
      console.log(`        API Request [chunk ${i+1}/${contentChunks.length}]: model=openai/gpt-oss-safeguard-20b, content_length=${chunk.length}`);
    }

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
      max_tokens: 200,
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

    if (args.verbose && response.status !== 200) {
      console.log(`        API Response [chunk ${i+1}/${contentChunks.length}]: status=${response.status}`);
    }

    if (response.status === 429) { // Rate limit
      const errorDetails = await response.text();

      if (args.verbose) {
        console.log(`        Rate Limit Response:`, errorDetails);
      }

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

      if (args.verbose) {
        console.log(`        Waiting ${waitTime/1000}s (API suggested + 5s) due to rate limit...`);
      }
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
        if (args.verbose) {
          console.error(`        Retry failed with status ${retryResponse.status}`);
        }
        continue;
      }

      const retryData = await retryResponse.json();
      const retryResult = retryData.choices?.[0]?.message?.content?.trim() || '';

      // Process the retry result using the API's actual response
      if (retryResult.includes("CONCERNING CONTENT IDENTIFIED")) {
        hasViolation = true;
        if (args.verbose) {
          console.log(`        Chunk ${i+1}/${contentChunks.length}: ${retryResult}`);
        }
      } else if (retryResult.includes("NO CONCERNS IDENTIFIED")) {
        if (args.verbose) {
          console.log(`        Chunk ${i+1}/${contentChunks.length}: ${retryResult}`);
        }
      } else {
        const isViolation = retryResult.toLowerCase().includes('concerning') ||
                           retryResult.toLowerCase().includes('violation') ||
                           retryResult.toLowerCase().includes('harmful');
        if (isViolation) {
          hasViolation = true;
        }
        if (args.verbose) {
          console.log(`        Chunk ${i+1}/${contentChunks.length}: ${retryResult}`);
        }
      }

      continue;
    }

    if (!response.ok) {
      if (args.verbose) {
        console.error(`        API request failed with status ${response.status}`);
      }
      continue;
    }

    const data = await response.json();

    if (args.verbose) {
      console.log(`        API Response [chunk ${i+1}/${contentChunks.length}]: has_choices=${!!data.choices}, choice_count=${data.choices?.length || 0}`);
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      if (args.verbose) {
        console.warn(`        Unexpected response format for chunk ${i+1}:`, JSON.stringify(data));
      }
      continue;
    }

    const result = data.choices[0]?.message?.content?.trim() || '';

    if (args.verbose) {
      console.log(`        API Result [chunk ${i+1}/${contentChunks.length}]: "${result.substring(0, 100)}..."`);
    }

    if (!result) {
      hasViolation = true; // Treat empty response as violation
      if (args.verbose) {
        console.log(`        Empty response from API for chunk ${i+1}, treating as violation`);
      }
      continue;
    }

    // Use the API's actual response rather than our interpretations
    if (result.includes("CONCERNING CONTENT IDENTIFIED")) {
      hasViolation = true;
      if (args.verbose) {
        console.log(`        Chunk ${i+1}/${contentChunks.length}: ${result}`);
      }
    } else if (result.includes("NO CONCERNS IDENTIFIED")) {
      if (args.verbose) {
        console.log(`        Chunk ${i+1}/${contentChunks.length}: ${result}`);
      }
    } else {
      // Check for violation indicators in the API's actual response
      const isViolation = result.toLowerCase().includes('concerning') ||
                         result.toLowerCase().includes('violation') ||
                         result.toLowerCase().includes('harmful');
      if (isViolation) {
        hasViolation = true;
      }
      if (args.verbose) {
        console.log(`        Chunk ${i+1}/${contentChunks.length}: ${result}`);
      }
    }
  }

  if (args.verbose) {
    console.log(`        Content analysis completed with ${contentChunks.length} chunk(s). Violation: ${hasViolation}`);
  }

  return hasViolation;
}

// Define TypeScript interface for the response (matches server API response)
interface StorageObject {
  ObjectName: string;  // Using the exact property name from server API
  Length: number;
  LastChanged: string;
  IsDirectory: boolean;
}

// Function to scan an image with Arachnid Shield SDK
async function scanImageWithArachnidShield(imageUrl: string): Promise<any> {
  // Create an instance of ArachnidShield with the API credentials
  // Using default base URL for Arachnid Shield
  const shield = new ArachnidShield(ARACHNID_API_USERNAME, ARACHNID_API_PASSWORD);

  // Perform the scan using the SDK - method is scanMediaFromUrl, not scanUrl
  const result = await shield.scanMediaFromUrl(imageUrl);
  return result;
}

// Function to fetch file content from Bunny storage
async function fetchFileContent(fileUrl: string): Promise<string> {
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`Error fetching file content from ${fileUrl}:`, error);
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

      // Filter for files that should be scanned with Groq (text-based files)
      const groqFiles = allowedFiles.filter(obj => {
        const ext = '.' + obj.ObjectName.toLowerCase().split('.').pop();
        return textExtensions.includes(ext);
      });

      // Display count of total allowed files only in verbose mode or when not using violations-only
      if (args.verbose || !args['violations-only']) {
        console.log(`    Total allowed files found: ${allowedFiles.length}`);
      }

      // Scan files that should be scanned with GPT-OSS-Safeguard (text-based files)
      if (runSafeguardScan && groqFiles.length > 0) {
        // Only display the "Text-based files found" line if not in violations-only mode
        if (!args['violations-only']) {
          console.log(`    Text-based files found: ${groqFiles.length}`);
        }

        for (let i = 0; i < groqFiles.length; i++) {
          const file = groqFiles[i];
          // Properly encode the path and handle potential double slashes
          // We should use the same approach as the original API call to Bunny
          const fileUrl = `${BUNNY_PULL_ZONE}${file.ObjectName}`;

          // Show scanning message only if not in violations-only mode or if we'll print a violation
          let shouldShowScanning = !args['violations-only'];

          try {
            // Fetch the content of the file
            const fileContent = await fetchFileContent(fileUrl);

            // Moderate the content with GPT OSS Safeguard
            const hasViolation = await moderateContentWithSafeguard(fileContent);

            if (args.verbose) {
              if (hasViolation) {
                // Always show file being scanned if it has a violation
                if (!shouldShowScanning) {
                  console.log(`      GPT-OSS-SAFEGUARD TEXT SCAN: ${file.ObjectName}`);
                  shouldShowScanning = true;
                }
                console.log(`        Status: GPT-OSS-SAFEGUARD VIOLATION DETECTED`);
              } else if (!args['violations-only']) {
                // Only show "No violation detected" if not in violations-only mode
                if (!shouldShowScanning) {
                  console.log(`      GPT-OSS-SAFEGUARD TEXT SCAN: ${file.ObjectName}`);
                  shouldShowScanning = true;
                }
                console.log(`        Status: No violation detected by GPT-OSS-SAFEGUARD`);
              }
            } else {
              // Clean minimal output: "filename: result"
              if (args['violations-only']) {
                if (hasViolation) {
                  console.log(`  ${file.ObjectName}: GPT-OSS-SAFEGUARD TEXT VIOLATION DETECTED`);
                }
              } else {
                console.log(`  ${file.ObjectName}: ${hasViolation ? 'GPT-OSS-SAFEGUARD TEXT VIOLATION DETECTED' : 'GPT-OSS-SAFEGUARD OK'}`);
              }
            }

            // Add a delay between file processing to avoid rate limiting
            if (i < groqFiles.length - 1) { // Don't delay after the last file
              await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between files
            }
          } catch (error) {
            console.error(`        Error scanning ${file.ObjectName}:`, error);
          }
        }
      } else {
        if (!args['violations-only'] && runSafeguardScan) {
          console.log("    No text-based files found");
        }
      }

      // Scan files with Arachnid Shield
      if (runShieldScan && shieldFiles.length > 0) {
        // Only display the "Media files found" line if not in violations-only mode
        if (!args['violations-only']) {
          console.log(`    Media files found: ${shieldFiles.length}`);
        }

        // Scan each file with Arachnid Shield SDK
        for (const shieldFile of shieldFiles) {
          let shouldShowScanning = !args['violations-only'];

          try {
            // Ensure proper URL path construction for nested files
            const imageUrl = `${BUNNY_PULL_ZONE}${shieldFile.ObjectName}`;

            const scanResult = await scanImageWithArachnidShield(imageUrl);

            if (args.verbose) {
              if (scanResult.status === 'ok') {
                // CSAM was detected - always show this if there's a violation
                if (!shouldShowScanning) {
                  console.log(`      ARACHNID SHIELD MEDIA SCAN: ${shieldFile.ObjectName}`);
                  shouldShowScanning = true;
                }
                console.log(`        Status: ARACHNID SHIELD CSAM detected`); // CSAM was detected
                if (scanResult.data.risk) {
                  console.log(`        Risk Level: ${scanResult.data.risk}`);
                }
              } else if (scanResult.status === 'err') {
                // No CSAM detected - only show if not in violations-only mode
                if (!args['violations-only']) {
                  if (!shouldShowScanning) {
                    console.log(`      ARACHNID SHIELD MEDIA SCAN: ${shieldFile.ObjectName}`);
                    shouldShowScanning = true;
                  }
                  console.log(`        Status: No CSAM detected by ARACHNID SHIELD`);
                }
              } else {
                // Unknown status - only show if not in violations-only mode
                if (!args['violations-only']) {
                  if (!shouldShowScanning) {
                    console.log(`      ARACHNID SHIELD MEDIA SCAN: ${shieldFile.ObjectName}`);
                    shouldShowScanning = true;
                  }
                  console.log(`        Status: ${scanResult.status || 'Unknown'} (ARACHNID SHIELD)`);
                }
              }
            } else {
              // Clean minimal output: "filename: result"
              if (args['violations-only']) {
                if (scanResult.status === 'ok') {
                  console.log(`  ${shieldFile.ObjectName}: ARACHNID SHIELD CSAM DETECTED`);
                }
              } else {
                console.log(`  ${shieldFile.ObjectName}: ${scanResult.status === 'ok' ? 'ARACHNID SHIELD CSAM DETECTED' : 'ARACHNID SHIELD OK'}`);
              }
            }
          } catch (error) {
            console.error(`        Error scanning ${shieldFile.ObjectName}:`, error);
          }
        }
      } else {
        if (!args['violations-only'] && args.verbose && runShieldScan) {
          console.log("    No media files found");
        }
      }
      if (!args['violations-only'] || args.verbose) {
        console.log("");
      }
    }
  } else {
    console.log("No username folders found.");
  }
}

export { main, listStorageObjects, scanImageWithArachnidShield };

// Only run main if this file is executed directly (not imported)
if (process.argv[1] === import.meta.path) {
  main();
}
