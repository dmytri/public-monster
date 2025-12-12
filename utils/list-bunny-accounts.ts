import { ArachnidShield } from "../vendor/arachnid-shield-sdk/src/index";
import { parseArgs } from "util";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// TYPESCRIPT INTERFACES
// ============================================================================

interface StorageObject {
  ObjectName: string;
  Length: number;
  LastChanged: string;
  IsDirectory: boolean;
}

interface ScannerResult {
  hasViolation: boolean;
  result: string;
}

interface ScannerHandler {
  scan(content: string, isImageUrl: boolean, reporter: Reporter): Promise<ScannerResult>;
  getCacheKey(filePath: string, isImageUrl: boolean): string;
}

interface Reporter {
  verbose: boolean;
  violationsOnly: boolean;
  depth: number;
  ok(file: string, scanner: string): void;
  violation(file: string, scanner: string, details?: string): void;
  info(message: string): void;
  verboseInfo(message: string): void;
  jsonString(obj: any): string;
  error(file: string, error: any): void;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const FILE_EXTENSIONS = {
  all: [
    // source
    '.html', '.htm', '.shtml', '.shtm', '.xhtml', '.xht',
    '.css', '.js', '.mjs', '.md', '.mdx', '.jsx', '.riot', '.tag',
    // fonts
    '.woff', '.woff2', '.ttf', '.otf',
    // images
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.svgz', '.ico',
    '.avif', '.heic', '.heif', '.bmp', '.tiff', '.tif',
    // media
    '.mp4', '.webm', '.mp3', '.wav', '.mid', '.midi', '.ogg', '.ogv', '.mov', '.qt',
    // 3d
    '.glb', '.gltf',
    // data
    '.txt', '.json', '.xml', '.csv', '.tsv', '.yaml', '.yml',
    '.ini', '.conf', '.properties', '.env',
    // feeds
    '.rss', '.atom', '.rdf',
    // archives
    '.zip', '.tar', '.tgz', '.gz', '.bz2', '.xz', '.7z',
    // documents
    '.pdf',
    // manifests
    '.webmanifest', '.map'
  ],

  shield: [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
    '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif',
    '.mp4', '.webm', '.mov', '.qt', '.ogv',
    '.mid', '.midi', '.mp3', '.wav', '.ogg',
    '.glb', '.gltf'
  ],

  text: [
    '.html', '.htm', '.shtml', '.shtm', '.xhtml', '.xht',
    '.css', '.js', '.mjs', '.md', '.mdx', '.jsx', '.riot', '.tag',
    '.txt', '.json', '.xml', '.csv', '.tsv', '.yaml', '.yml',
    '.ini', '.conf', '.properties', '.env', '.rss', '.atom', '.rdf',
    '.webmanifest', '.map', '.svg'
  ],

  llamaGuard: [
    '.html', '.htm', '.shtml', '.shtm', '.xhtml', '.xht',
    '.css', '.js', '.mjs', '.md', '.mdx', '.jsx', '.riot', '.tag',
    '.txt', '.json', '.xml', '.csv', '.tsv', '.yaml', '.yml',
    '.ini', '.conf', '.properties', '.env', '.rss', '.atom', '.rdf',
    '.webmanifest', '.map', '.svg',
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp',
    '.tiff', '.tif', '.ico', '.avif', '.heic', '.heif'
  ]
};

const CONFIG = {
  cache: {
    dir: '!moderation/.cache/'
  },

  chunking: {
    maxSize: 28000,
    tagBoundaryRegex: /(<\/\w+>)/g,
    paragraphSplitRegex: /(?:\r?\n\s*){2,}/
  },

  rateLimiting: {
    defaultWaitMs: 10000,
    bufferMs: 5000,
    waitTimeRegex: /try again in (\d+\.?\d*)s/,
    delayBetweenFilesMs: 2000
  },

  models: {
    safeguard: 'openai/gpt-oss-safeguard-20b',
    llamaGuard: 'meta-llama/llama-guard-4-12b',
    explain: 'meta-llama/llama-4-scout-17b-16e-instruct'
  },

  apiLimits: {
    safeguard: {
      temperature: 0,
      maxTokens: 1024
    },
    llamaGuard: {
      temperature: 0,
      maxTokens: 200
    },
    explain: {
      temperature: 0.7,
      maxTokens: 1000,
      maxTextLength: 2000,
      wordLimit: 20
    }
  },

  policies: {
    safeguard: `
    You are a content safety evaluator for public.monster. Your task is to identify specific types of harmful content.

    CRITERIA FOR CONCERNING CONTENT (respond with the exact phrase "CONCERNING CONTENT IDENTIFIED"):
    1. Child Sexual Abuse Material (CSAM)
    2. Malicious code (miners, viruses, phishing)
    3. Direct personal harm (doxxing, harassment, non-consensual intimate images)
    4. Hate speech (targeting race, gender identity)
    5. Explicit illegal activity

    If the content contains any of these, respond with: "CONCERNING CONTENT IDENTIFIED"
    For all other content, respond with: "NO CONCERNS IDENTIFIED"

    Content to evaluate:`,

    llamaGuard: `
    You are a content safety expert. Your task is to classify content as 'safe' or 'unsafe'.

    CATEGORIES OF UNSAFE CONTENT:
    O1: Violent Content (e.g., descriptions of physical harm, fighting)
    O2: Hate Speech (e.g., derogatory terms, discrimination based on protected characteristics)
    O3: Sexual Content (e.g., explicit descriptions, non-consensual intimate imagery)
    O4: Self-Harm (e.g., promotion of self-mutilation, suicide ideation)
    O5: Illegal Activities (e.g., drug manufacturing, illegal weapons, child exploitation)

    If content falls into any UNSAFE category, respond with: "UNSAFE: [CATEGORY_CODE]"
    If content is SAFE, respond with: "SAFE"

    Content to evaluate:`
  },

  storage: {
    maxRecursionDepth: 10
  },

  cli: {
    argsConfig: {
      'list-users': { type: 'boolean' as const },
      'violations-only': { type: 'boolean' as const },
      'user': { type: 'string' as const },
      'help': { type: 'boolean' as const },
      'verbose': { type: 'boolean' as const },
      'shield': { type: 'boolean' as const },
      'safeguard': { type: 'boolean' as const },
      'guard': { type: 'boolean' as const },
      'explain': { type: 'boolean' as const },
      'no-cache': { type: 'boolean' as const },
      'console-depth': { type: 'string' as const }
    },

    helpText: `
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
  --explain           Run explanation scans using meta-llama/llama-4-scout-17b-16e-instruct model for both text and images (via GROQ)
  --no-cache          Ignore existing cache files but still create new ones (overrides default caching behavior)
  --console-depth     Set the depth for console object inspection (Bun runtime flag)

Examples:
  bun run run --list-users           # List all users
  bun run run --user ~username       # Scan a specific user
  bun run run --violations-only      # Show only violations
  bun run run --user ~username --violations-only # Scan specific user and show only violations
  bun run run --verbose              # Show detailed API responses
  bun run run --shield               # Run only shield scans
  bun run run --safeguard            # Run only safeguard scans
    `
  }
};

// Read environment variables
const BUNNY_API_KEY = process.env.BUNNY_API_KEY;
const BUNNY_STORAGE_URL = process.env.BUNNY_STORAGE_URL;
const BUNNY_PULL_ZONE = process.env.BUNNY_PULL_ZONE;
const ARACHNID_API_USERNAME = process.env.ARACHNID_API_USERNAME;
const ARACHNID_API_PASSWORD = process.env.ARACHNID_API_PASSWORD;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_BASE_URL = process.env.GROQ_API_BASE_URL;
const STORAGE_ZONE_NAME = BUNNY_STORAGE_URL ? new URL(BUNNY_STORAGE_URL).pathname.split('/').pop() : undefined;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getFileExtension(filename: string): string {
  const lowerFilename = filename.toLowerCase();
  const dotIndex = lowerFilename.lastIndexOf('.');
  return dotIndex === -1 ? '' : lowerFilename.substring(dotIndex);
}

function matchesExtensions(filename: string, extensions: string[]): boolean {
  const ext = getFileExtension(filename);
  return ext !== '' && extensions.includes(ext);
}

function categorizeFile(filename: string): 'shield' | 'text' | 'llamaGuard' | 'unknown' {
  if (matchesExtensions(filename, FILE_EXTENSIONS.shield)) return 'shield';
  if (matchesExtensions(filename, FILE_EXTENSIONS.text)) return 'text';
  if (matchesExtensions(filename, FILE_EXTENSIONS.llamaGuard)) return 'llamaGuard';
  return 'unknown';
}

function buildFileUrl(objectName: string): string {
  return `${BUNNY_PULL_ZONE}${encodeURI(objectName)}`;
}

function computeContentHash(content: string): string {
  const hasher = new Bun.CryptoHasher("md4");
  hasher.update(content);
  return hasher.digest("hex");
}

function buildGroqHeaders(apiKey: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };
}

function extractWaitTime(errorResponse: string): number {
  try {
    const errorObj = JSON.parse(errorResponse);
    if (errorObj.error?.message) {
      const match = errorObj.error.message.match(CONFIG.rateLimiting.waitTimeRegex);
      if (match) {
        const apiWaitTime = parseFloat(match[1]);
        return Math.ceil(apiWaitTime * 1000) + CONFIG.rateLimiting.bufferMs;
      }
    }
  } catch (e) {
    // Parsing failed, use default
  }
  return CONFIG.rateLimiting.defaultWaitMs;
}

function validateGroqResponse(data: any): boolean {
  return !!(data.choices && data.choices[0] && data.choices[0].message);
}

function extractMessageContent(data: any): string {
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function detectViolation(result: string, exactKeyword?: string, fallbackKeywords?: string[]): boolean {
  if (exactKeyword && result.includes(exactKeyword)) {
    return true;
  }

  if (fallbackKeywords) {
    const lowerResult = result.toLowerCase();
    return fallbackKeywords.some(keyword => lowerResult.includes(keyword));
  }

  return false;
}

// ============================================================================
// CONTENT CHUNKING
// ============================================================================

class ContentChunker {
  static chunkContent(content: string, maxSize: number = CONFIG.chunking.maxSize): string[] {
    if (content.length <= maxSize) {
      return [content];
    }

    // Check if content is HTML
    if (content.includes('<') && content.includes('>')) {
      return this.chunkHtmlContent(content, maxSize);
    } else {
      return this.chunkPlainText(content, maxSize);
    }
  }

  private static chunkHtmlContent(content: string, maxSize: number): string[] {
    const segments: string[] = [];
    let lastIndex = 0;
    let currentChunk = '';
    let match;
    const tagBoundaries = new RegExp(CONFIG.chunking.tagBoundaryRegex);

    while ((match = tagBoundaries.exec(content)) !== null) {
      const segment = content.substring(lastIndex, match.index + match[0].length);

      if ((currentChunk + segment).length > maxSize && currentChunk !== '') {
        segments.push(currentChunk);
        currentChunk = segment;
      } else {
        currentChunk += segment;
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      const remaining = content.substring(lastIndex);
      if ((currentChunk + remaining).length <= maxSize) {
        currentChunk += remaining;
      } else {
        if (currentChunk !== '') {
          segments.push(currentChunk);
        }
        if (remaining.length > maxSize) {
          for (let i = 0; i < remaining.length; i += maxSize) {
            segments.push(remaining.substring(i, i + maxSize));
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

    return segments;
  }

  private static chunkPlainText(content: string, maxSize: number): string[] {
    const paragraphs = content.split(CONFIG.chunking.paragraphSplitRegex);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const paragraph of paragraphs) {
      if ((currentChunk + paragraph).length > maxSize && currentChunk !== '') {
        chunks.push(currentChunk);
        currentChunk = paragraph;
      } else {
        currentChunk += paragraph;
      }
    }

    if (currentChunk.trim() !== '') {
      chunks.push(currentChunk);
    }

    return chunks;
  }
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

class CacheManager {
  private cacheDir: string;

  constructor(cacheDir: string = CONFIG.cache.dir) {
    this.cacheDir = cacheDir;
    this.ensureDir();
  }

  // Scan result cache
  checkScan(hash: string, model: string): boolean {
    return existsSync(this.getCachePath(hash, model));
  }

  saveScan(hash: string, model: string, response: string = ""): void {
    Bun.write(this.getCachePath(hash, model), response);
  }

  async readScanResponse(hash: string, model: string): Promise<string | null> {
    const path = this.getCachePath(hash, model);
    if (existsSync(path)) {
      return await Bun.file(path).text();
    }
    return null;
  }

  // File content cache
  saveFileData(hash: string, data: string): void {
    Bun.write(this.getCachePath(hash, 'data'), data);
  }

  async readFileData(hash: string): Promise<string | null> {
    const path = this.getCachePath(hash, 'data');
    if (existsSync(path)) {
      return await Bun.file(path).text();
    }
    return null;
  }

  // ETag cache
  saveEtag(hash: string, etag: string): void {
    Bun.write(this.getCachePath(hash, 'etag'), etag);
  }

  async readEtag(hash: string): Promise<string | null> {
    const path = this.getCachePath(hash, 'etag');
    if (existsSync(path)) {
      return await Bun.file(path).text();
    }
    return null;
  }

  private ensureDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private getCachePath(hash: string, suffix: string): string {
    return join(this.cacheDir, `${hash}.${suffix}`);
  }
}

// Global cache manager instance
const cacheManager = new CacheManager();

// ============================================================================
// API CLIENT
// ============================================================================

class GroqApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async makeRequest(
    model: string,
    messages: any[],
    temperature: number,
    maxTokens: number,
    reporter: Reporter
  ): Promise<any> {
    const requestBody = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };

    const response = await this.handleRateLimit(
      () => fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildGroqHeaders(this.apiKey),
        body: JSON.stringify(requestBody)
      }),
      reporter
    );

    return await response.json();
  }

  async handleRateLimit(requestFn: () => Promise<Response>, reporter: Reporter): Promise<Response> {
    let response = await requestFn();

    if (response.status === 429) {
      const errorDetails = await response.text();
      reporter.verboseInfo(`        Rate Limit Response: ${errorDetails}`);

      const waitTime = extractWaitTime(errorDetails);
      reporter.verboseInfo(`        Waiting ${waitTime/1000}s due to rate limit...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Retry once
      response = await requestFn();
    }

    return response;
  }

  async extractErrorDetails(response: Response): Promise<string> {
    return await response.text();
  }
}

// ============================================================================
// REPORTER FACTORY
// ============================================================================

function createReporter(options: {
  verbose: boolean;
  violationsOnly: boolean;
  depth: number;
  onViolation?: () => void;
}): Reporter {
  const { verbose, violationsOnly, depth, onViolation } = options;

  return {
    verbose,
    violationsOnly,
    depth,

    ok(file: string, scanner: string) {
      if (violationsOnly) return;

      const message = verbose
        ? `        Status: No violation detected by ${scanner}`
        : `  ${file}: ${scanner} OK`;
      console.log(message);
    },

    violation(file: string, scanner: string, details?: string) {
      if (onViolation) onViolation();

      const baseMessage = verbose
        ? `        Status: ${scanner} VIOLATION DETECTED`
        : `  ${file}: ${scanner} VIOLATION DETECTED`;

      console.log(baseMessage);
      if (verbose && details) {
        console.log(`        Details: ${details}`);
      }
    },

    info(message: string) {
      if (!violationsOnly) {
        console.log(message);
      }
    },

    verboseInfo(message: string) {
      if (verbose) {
        console.log(message);
      }
    },

    jsonString(obj: any): string {
      return JSON.stringify(obj, null, depth);
    },

    error(file: string, error: any) {
      console.error(`        Error scanning ${file}:`, error);
      if (onViolation) onViolation();
    }
  };
}

// ============================================================================
// CONTENT MODERATION FUNCTIONS
// ============================================================================

async function moderateContentWithSafeguard(content: string, reporter: Reporter): Promise<boolean> {
  if (!GROQ_API_KEY || !GROQ_API_BASE_URL) {
    throw new Error('GROQ_API_KEY and/or GROQ_API_BASE_URL are not set in environment variables');
  }

  if (!content) {
    return false;
  }

  const groqClient = new GroqApiClient(GROQ_API_KEY, GROQ_API_BASE_URL);
  const contentChunks = ContentChunker.chunkContent(content);
  let hasViolation = false;

  for (let i = 0; i < contentChunks.length; i++) {
    const chunk = contentChunks[i];
    reporter.verboseInfo(`        API Request [chunk ${i+1}/${contentChunks.length}]: model=${CONFIG.models.safeguard}, content_length=${chunk.length}`);

    const messages = [
      { role: 'system', content: CONFIG.policies.safeguard },
      { role: 'user', content: chunk }
    ];

    try {
      const data = await groqClient.makeRequest(
        CONFIG.models.safeguard,
        messages,
        CONFIG.apiLimits.safeguard.temperature,
        CONFIG.apiLimits.safeguard.maxTokens,
        reporter
      );

      reporter.verboseInfo(`        API Response [chunk ${i+1}/${contentChunks.length}]: has_choices=${!!data.choices}, choice_count=${data.choices?.length || 0}`);

      if (!validateGroqResponse(data)) {
        reporter.verboseInfo(`        Unexpected response format for chunk ${i+1}: ${reporter.jsonString(data)}`);
        continue;
      }

      const result = extractMessageContent(data);
      if (result) {
        reporter.verboseInfo(`        API Result [chunk ${i+1}/${contentChunks.length}]:\n${result}`);
      }

      if (!result) {
        reporter.verboseInfo(`        Empty response from API for chunk ${i+1}, treating as OK.`);
        continue;
      }

      const isViolation = detectViolation(result, "CONCERNING CONTENT IDENTIFIED", ['concerning', 'violation', 'harmful']);
      if (isViolation) {
        hasViolation = true;
        reporter.verboseInfo(`        Chunk ${i+1}/${contentChunks.length} Analysis:\n${reporter.jsonString(data.choices[0])}`);
      }
    } catch (error) {
      reporter.verboseInfo(`        Error processing chunk ${i+1}: ${error}`);
      continue;
    }
  }

  reporter.verboseInfo(`        Content analysis completed with ${contentChunks.length} chunk(s). Violation: ${hasViolation}`);
  return hasViolation;
}

async function moderateWithLlamaGuard(content: string, isImageUrl: boolean, reporter: Reporter): Promise<{ hasViolation: boolean, result: string }> {
  if (!GROQ_API_KEY || !GROQ_API_BASE_URL) {
    throw new Error('GROQ_API_KEY and/or GROQ_API_BASE_URL are not set in environment variables');
  }

  if (!content) {
    return { hasViolation: false, result: "SAFE (empty content)" };
  }

  const groqClient = new GroqApiClient(GROQ_API_KEY, GROQ_API_BASE_URL);

  if (isImageUrl) {
    // For images, don't chunk
    const contentToScan = `Image URL: ${content}`;

    reporter.verboseInfo(`        Llama Guard API Request: model=${CONFIG.models.llamaGuard}, is_image=true`);

    try {
      const messages = [
        { role: 'system', content: CONFIG.policies.llamaGuard },
        { role: 'user', content: contentToScan }
      ];

      const data = await groqClient.makeRequest(
        CONFIG.models.llamaGuard,
        messages,
        CONFIG.apiLimits.llamaGuard.temperature,
        CONFIG.apiLimits.llamaGuard.maxTokens,
        reporter
      );

      if (!validateGroqResponse(data)) {
        const errorResult = `Unexpected response format: ${reporter.jsonString(data)}`;
        reporter.verboseInfo(`        ${errorResult}`);
        return { hasViolation: true, result: `API Format Error: ${errorResult}` };
      }

      const result = extractMessageContent(data);
      reporter.verboseInfo(`        Llama Guard API Result:\n${result}`);

      const isUnsafe = result.startsWith("UNSAFE");
      return { hasViolation: isUnsafe, result: isUnsafe ? result : "SAFE" };
    } catch (error: any) {
      reporter.error("Llama Guard API", error);
      return { hasViolation: true, result: `Exception: ${error.message || error}` };
    }
  }

  // For text content, chunk it
  const contentChunks = ContentChunker.chunkContent(content);
  let hasViolation = false;
  let lastResult = "SAFE";

  for (let i = 0; i < contentChunks.length; i++) {
    const chunk = contentChunks[i];
    reporter.verboseInfo(`        Llama Guard API Request [chunk ${i+1}/${contentChunks.length}]: model=${CONFIG.models.llamaGuard}, content_length=${chunk.length}`);

    try {
      const messages = [
        { role: 'system', content: CONFIG.policies.llamaGuard },
        { role: 'user', content: chunk }
      ];

      const data = await groqClient.makeRequest(
        CONFIG.models.llamaGuard,
        messages,
        CONFIG.apiLimits.llamaGuard.temperature,
        CONFIG.apiLimits.llamaGuard.maxTokens,
        reporter
      );

      if (!validateGroqResponse(data)) {
        reporter.verboseInfo(`        Unexpected response for chunk ${i+1}: ${reporter.jsonString(data)}`);
        continue;
      }

      const result = extractMessageContent(data);
      lastResult = result;
      reporter.verboseInfo(`        Llama Guard API Result [chunk ${i+1}/${contentChunks.length}]:\n${result}`);

      if (result.startsWith("UNSAFE")) {
        hasViolation = true;
      }
    } catch (error: any) {
      reporter.error("Llama Guard API", error);
      return { hasViolation: true, result: `Exception: ${error.message || error}` };
    }
  }

  return { hasViolation, result: hasViolation ? lastResult : "SAFE" };
}

async function explainContentWithGROQ(content: string, isImageUrl: boolean, reporter: Reporter): Promise<{ hasViolation: boolean, result: string }> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY environment variable is required");
  }

  const groqClient = new GroqApiClient(GROQ_API_KEY!, GROQ_API_BASE_URL!);

  let messages: any[];
  if (isImageUrl) {
    messages = [
      {
        role: "user",
        content: [
          { type: "text", text: `In ${CONFIG.apiLimits.explain.wordLimit} words or less, describe and classify this image using standard movie-style parental guidance.` },
          { type: "image_url", image_url: { url: content } }
        ]
      }
    ];
  } else {
    // Clean HTML content
    let cleanedContent = content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedContent.length > CONFIG.apiLimits.explain.maxTextLength) {
      cleanedContent = cleanedContent.substring(0, CONFIG.apiLimits.explain.maxTextLength);
    }

    messages = [
      {
        role: "user",
        content: `In ${CONFIG.apiLimits.explain.wordLimit} words or less, describe as concisely as possible\n\nCONTENT:\n\`\`\`${cleanedContent}\`\`\``
      }
    ];
  }

  reporter.verboseInfo(`        Calling GROQ API for explanation with model: ${CONFIG.models.explain} (isImageUrl: ${isImageUrl})`);

  try {
    const data = await groqClient.makeRequest(
      CONFIG.models.explain,
      messages,
      CONFIG.apiLimits.explain.temperature,
      CONFIG.apiLimits.explain.maxTokens,
      reporter
    );

    if (!validateGroqResponse(data)) {
      const errorResult = `Unexpected response format: ${reporter.jsonString(data)}`;
      reporter.verboseInfo(`        ${errorResult}`);
      return { hasViolation: true, result: `API Format Error: ${errorResult}` };
    }

    const explanation = extractMessageContent(data);
    reporter.verboseInfo(`        GROQ Explanation API Result:\n${explanation}`);
    return { hasViolation: false, result: explanation };
  } catch (error: any) {
    const errorResult = `Request failed: ${error.message || error}`;
    reporter.error("GROQ Explanation API", errorResult);
    return { hasViolation: true, result: `API Error: ${errorResult}` };
  }
}

async function scanImageWithArachnidShieldFromUrl(fileUrl: string, reporter: Reporter): Promise<any> {
  const shield = new ArachnidShield(ARACHNID_API_USERNAME!, ARACHNID_API_PASSWORD!);
  reporter.verboseInfo(`        Pinging Arachnid Shield API for: ${fileUrl}`);
  const scanResult = await shield.scanMediaFromUrl(fileUrl);
  reporter.verboseInfo(`        Arachnid Shield API raw response:\n${reporter.jsonString(scanResult)}`);
  return scanResult;
}

// ============================================================================
// SCANNER HANDLER CLASSES
// ============================================================================

class SafeguardHandler implements ScannerHandler {
  async scan(content: string, isImageUrl: boolean, reporter: Reporter): Promise<ScannerResult> {
    const hasViolation = await moderateContentWithSafeguard(content, reporter);
    const result = hasViolation ? 'VIOLATION DETECTED' : 'SAFE';
    return { hasViolation, result };
  }

  getCacheKey(filePath: string, isImageUrl: boolean): string {
    return computeContentHash(filePath + ':safeguard');
  }
}

class GuardHandler implements ScannerHandler {
  async scan(content: string, isImageUrl: boolean, reporter: Reporter): Promise<ScannerResult> {
    const result = await moderateWithLlamaGuard(content, isImageUrl, reporter);
    return { hasViolation: result.hasViolation, result: result.result };
  }

  getCacheKey(filePath: string, isImageUrl: boolean): string {
    return computeContentHash(filePath + ':guard');
  }
}

class ShieldHandler implements ScannerHandler {
  async scan(url: string, isImageUrl: boolean, reporter: Reporter): Promise<ScannerResult> {
    const shield = new ArachnidShield(ARACHNID_API_USERNAME!, ARACHNID_API_PASSWORD!);
    reporter.verboseInfo(`        Pinging Arachnid Shield API for: ${url}`);
    const scanResult = await shield.scanMediaFromUrl(url);
    reporter.verboseInfo(`        Arachnid Shield API raw response:\n${reporter.jsonString(scanResult)}`);

    let hasViolation = false;
    let result = 'SAFE';

    if (scanResult.status === 'ok' && scanResult.data.is_match) {
      hasViolation = true;
      result = scanResult.data.classification ? `CSAM Match - Classification: ${scanResult.data.classification}` : 'CSAM Match';
    } else if (scanResult.status === 'err') {
      hasViolation = true;
      result = `Error: ${scanResult.data}`;
    }

    return { hasViolation, result: reporter.jsonString(scanResult) };
  }

  getCacheKey(filePath: string, isImageUrl: boolean): string {
    return computeContentHash(filePath + ':shield');
  }
}

class ExplainHandler implements ScannerHandler {
  async scan(content: string, isImageUrl: boolean, reporter: Reporter): Promise<ScannerResult> {
    const result = await explainContentWithGROQ(content, isImageUrl, reporter);
    return { hasViolation: false, result: result.result };
  }

  getCacheKey(filePath: string, isImageUrl: boolean): string {
    return computeContentHash(filePath + ':explain');
  }
}

// ============================================================================
// GENERIC SCANNING
// ============================================================================

async function genericScan(
  scannerHandler: ScannerHandler,
  filePath: string,
  isImageUrl: boolean,
  cacheType: string,
  reporter: Reporter,
  useCache: boolean = true,
  noCache: boolean = false
): Promise<{ hasViolation: boolean, result: string, apiCallMade: boolean }> {
  // Check cache FIRST with path-based key (no file fetch needed!)
  const cacheKey = scannerHandler.getCacheKey(filePath, isImageUrl);

  reporter.verboseInfo(`  ${filePath}: Checking ${cacheType} scan cache (key: ${cacheKey.substring(0, 8)}...)`);

  if (useCache && cacheManager.checkScan(cacheKey, cacheType)) {
    reporter.verboseInfo(`  ${filePath}: ✓ Found cached ${cacheType} scan result - SKIPPING SCANNER & FILE FETCH`);
    const cachedResponse = await cacheManager.readScanResponse(cacheKey, cacheType);
    reporter.info(`  ${filePath}: ${cacheType.toUpperCase()} OK (cached scan)`);
    if (reporter.verbose && cachedResponse) {
      reporter.verboseInfo(`        Cached ${cacheType.toUpperCase()} Response:\n${cachedResponse}`);
    }
    return { hasViolation: false, result: cachedResponse || 'SAFE (cached)', apiCallMade: false };
  }

  // Cache miss - NOW fetch the file
  reporter.verboseInfo(`  ${filePath}: ✗ No cached scan result - RUNNING ${cacheType.toUpperCase()} SCANNER`);

  const content = isImageUrl
    ? buildFileUrl(filePath)
    : (await fetchFileContent(filePath, noCache, reporter)).content;

  reporter.verboseInfo(`  ${filePath}: File content ready for scanning`);

  // Scan the content
  const scanResult = await scannerHandler.scan(content, isImageUrl, reporter);

  if (scanResult.hasViolation) {
    reporter.violation(filePath, cacheType.toUpperCase(), scanResult.result);
  } else {
    reporter.ok(filePath, cacheType.toUpperCase());
  }

  reporter.verboseInfo(`  ${filePath}: Saving scan result to cache (key: ${cacheKey.substring(0, 8)}...)`);
  cacheManager.saveScan(cacheKey, cacheType, scanResult.result);
  return { hasViolation: scanResult.hasViolation, result: scanResult.result, apiCallMade: true };
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

async function listStorageObjects(path: string = ""): Promise<StorageObject[]> {
  try {
    const url = `${BUNNY_STORAGE_URL}${path}`;
    const response = await fetch(url, {
      headers: { AccessKey: BUNNY_API_KEY! }
    });

    if (!response.ok) {
      console.error(`API request failed for path "${path}" with status ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error(`Error listing objects in path "${path}":`, error);
    return [];
  }
}

async function getAllObjectsRecursively(
  path: string = "/",
  depth: number = 0,
  maxDepth: number = CONFIG.storage.maxRecursionDepth
): Promise<StorageObject[]> {
  if (depth > maxDepth) {
    console.warn(`Max depth (${maxDepth}) reached for path: ${path}`);
    return [];
  }

  const url = `${BUNNY_STORAGE_URL}${path}`;
  const res = await fetch(url, { headers: { AccessKey: BUNNY_API_KEY! } });
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

async function fetchFileContent(objectName: string, noCache: boolean, reporter?: Reporter): Promise<{ content: string, etag: string | null }> {
  const contentHash = computeContentHash(objectName);
  const storageUrl = `${BUNNY_STORAGE_URL}${objectName}`;

  if (noCache) {
    const response = await fetch(storageUrl, {
      headers: { AccessKey: BUNNY_API_KEY! }
    });

    if (reporter) {
      reporter.verboseInfo(`  ${objectName}: HTTP ${response.status} (--no-cache mode)`);
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
    }

    const content = await response.text();
    const newEtag = response.headers.get('etag');

    if (newEtag) {
      cacheManager.saveEtag(contentHash, newEtag);
      cacheManager.saveFileData(contentHash, content);
      if (reporter) reporter.verboseInfo(`  ${objectName}: ETag: ${newEtag}`);
    }

    return { content, etag: newEtag };
  }

  // Try to use cache with ETag validation
  const cachedEtag = await cacheManager.readEtag(contentHash);
  const cachedData = await cacheManager.readFileData(contentHash);

  // Build headers - include If-None-Match if we have a cached ETag
  const headers: Record<string, string> = {
    AccessKey: BUNNY_API_KEY!
  };

  if (cachedEtag) {
    headers['If-None-Match'] = cachedEtag;
  }

  // Make conditional request to validate cache
  const response = await fetch(storageUrl, { headers });

  if (reporter) {
    reporter.verboseInfo(`  ${objectName}: HTTP ${response.status}${cachedEtag ? ' (conditional request)' : ' (no cache)'}`);
  }

  // 304 Not Modified - cached data is still valid
  if (response.status === 304) {
    if (cachedData !== null) {
      if (reporter) reporter.verboseInfo(`  ${objectName}: Using cached data (validated)`);
      return { content: cachedData, etag: cachedEtag };
    } else {
      throw new Error('Received 304 but no cached data found');
    }
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  // 200 OK - fetch new content
  const content = await response.text();
  const newEtag = response.headers.get('etag');

  if (newEtag) {
    cacheManager.saveEtag(contentHash, newEtag);
    cacheManager.saveFileData(contentHash, content);
    if (reporter) reporter.verboseInfo(`  ${objectName}: Cache updated with new ETag: ${newEtag}`);
  }

  return { content, etag: newEtag };
}

// ============================================================================
// MAIN FUNCTION HELPERS
// ============================================================================

function showHelp(): void {
  console.log(CONFIG.cli.helpText);
}

async function listUsers(): Promise<void> {
  console.log(`Fetching contents of storage zone: ${STORAGE_ZONE_NAME}\n`);

  const topLevelUrl = `${BUNNY_STORAGE_URL}/`;
  const topLevelRes = await fetch(topLevelUrl, {
    headers: { AccessKey: BUNNY_API_KEY! }
  });

  if (!topLevelRes.ok) {
    console.error(`Failed to fetch top-level directories: ${topLevelRes.status} ${topLevelRes.statusText}`);
    return;
  }

  const topLevelItems = await topLevelRes.json();
  const usernameFolders = topLevelItems.filter((item: any) =>
    item.IsDirectory && item.ObjectName.startsWith('~')
  );

  console.log("Username Folders (Directories):");
  console.log("===============================");
  for (const dir of usernameFolders) {
    console.log(`. ${dir.ObjectName}/`);
  }
}

async function getUserFolders(requestedUser?: string): Promise<any[]> {
  const topLevelUrl = `${BUNNY_STORAGE_URL}/`;
  const topLevelRes = await fetch(topLevelUrl, {
    headers: { AccessKey: BUNNY_API_KEY! }
  });

  if (!topLevelRes.ok) {
    console.error(`Failed to fetch top-level directories: ${topLevelRes.status} ${topLevelRes.statusText}`);
    return [];
  }

  const topLevelItems = await topLevelRes.json();
  let usernameFolders = topLevelItems.filter((item: any) =>
    item.IsDirectory && item.ObjectName.startsWith('~')
  );

  if (requestedUser) {
    const normalizedUser = requestedUser.startsWith('~') ? requestedUser : `~${requestedUser}`;
    usernameFolders = usernameFolders.filter((dir: any) => dir.ObjectName === normalizedUser);

    if (usernameFolders.length === 0) {
      console.log(`User ${normalizedUser} not found.`);
    }
  }

  return usernameFolders;
}

function filterFilesByType(files: StorageObject[], type: 'shield' | 'text' | 'llamaGuard' | 'all'): StorageObject[] {
  if (type === 'all') {
    return files.filter(obj => !obj.IsDirectory && matchesExtensions(obj.ObjectName, FILE_EXTENSIONS.all));
  }

  return files.filter(obj => !obj.IsDirectory && matchesExtensions(obj.ObjectName, FILE_EXTENSIONS[type]));
}

async function scanFilesWithHandler(
  files: StorageObject[],
  handler: ScannerHandler,
  handlerName: string,
  cacheType: string,
  reporter: Reporter,
  useCache: boolean,
  noCache: boolean
): Promise<void> {
  if (files.length === 0) {
    reporter.info(`    No files found for ${handlerName}`);
    return;
  }

  reporter.info(`    Files found for ${handlerName}: ${files.length}`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const isImageUrl = matchesExtensions(file.ObjectName, FILE_EXTENSIONS.shield);

    try {
      // Pass filePath to genericScan - it will check cache first, only fetch if needed
      const result = await genericScan(handler, file.ObjectName, isImageUrl, cacheType, reporter, useCache, noCache);

      // Only delay if scanner actually made an API call (cache miss)
      if (i < files.length - 1 && result.apiCallMade) {
        reporter.verboseInfo(`  Waiting ${CONFIG.rateLimiting.delayBetweenFilesMs/1000}s before next file (rate limiting)`);
        await new Promise(resolve => setTimeout(resolve, CONFIG.rateLimiting.delayBetweenFilesMs));
      }
    } catch (error) {
      reporter.error(file.ObjectName, error);
    }
  }
}

function setupConsoleDepthAndReporter(args: any): Reporter {
  const bunConsoleDepth = (globalThis as any).Bun?.consoleDepth || (globalThis as any).console?.depth || 2;
  const argConsoleDepth = args['console-depth'] !== undefined ? parseInt(args['console-depth']) : null;
  const baseConsoleDepth = argConsoleDepth !== null ? argConsoleDepth : bunConsoleDepth;
  const adjustedConsoleDepth = args.verbose ? Math.max(baseConsoleDepth, 8) : baseConsoleDepth;

  (console as any).depth = adjustedConsoleDepth;

  return createReporter({
    verbose: args.verbose,
    violationsOnly: args['violations-only'],
    depth: adjustedConsoleDepth
  });
}

async function scanUser(
  user: any,
  reporter: Reporter,
  scanConfig: { shield: boolean, safeguard: boolean, guard: boolean, explain: boolean },
  noCache: boolean
): Promise<boolean> {
  let userHasViolations = false;

  const userReporter = createReporter({
    verbose: reporter.verbose,
    violationsOnly: reporter.violationsOnly,
    depth: reporter.depth,
    onViolation: () => { userHasViolations = true; }
  });

  if (!reporter.violationsOnly) {
    console.log(`. ${user.ObjectName}/`);
  }

  const folderObjects = await getAllObjectsRecursively(`/${user.ObjectName}/`);
  const allFiles = filterFilesByType(folderObjects, 'all');
  userReporter.info(`    Total allowed files found: ${allFiles.length}`);

  // Safeguard scan (text files)
  if (scanConfig.safeguard) {
    const textFiles = filterFilesByType(folderObjects, 'text');
    await scanFilesWithHandler(
      textFiles,
      new SafeguardHandler(),
      'GPT-OSS-Safeguard',
      'safeguard',
      userReporter,
      !noCache,
      noCache
    );
  }

  // Llama Guard scan (text + images)
  if (scanConfig.guard) {
    const llamaGuardFiles = filterFilesByType(folderObjects, 'llamaGuard');
    await scanFilesWithHandler(
      llamaGuardFiles,
      new GuardHandler(),
      'Llama Guard',
      'guard',
      userReporter,
      !noCache,
      noCache
    );
  }

  // Explain scan
  if (scanConfig.explain) {
    const llamaGuardFiles = filterFilesByType(folderObjects, 'llamaGuard');
    const explainFiles = llamaGuardFiles;

    if (explainFiles.length > 0) {
      userReporter.info(`    Files found for explanation: ${explainFiles.length}`);

      for (let i = 0; i < explainFiles.length; i++) {
        const file = explainFiles[i];
        const isImageUrl = matchesExtensions(file.ObjectName, FILE_EXTENSIONS.shield);

        try {
          const explainHandler = new ExplainHandler();
          // Pass filePath - genericScan will check cache first, only fetch if needed
          const scanResult = await genericScan(explainHandler, file.ObjectName, isImageUrl, 'explain', userReporter, !noCache, noCache);

          if (scanResult.hasViolation) {
            userReporter.error(file.ObjectName, scanResult.result);
          } else {
            userReporter.info(`  Explanation for ${file.ObjectName}:\n${scanResult.result}`);
          }

          // Only delay if scanner actually made an API call (cache miss)
          if (i < explainFiles.length - 1 && scanResult.apiCallMade) {
            userReporter.verboseInfo(`  Waiting ${CONFIG.rateLimiting.delayBetweenFilesMs/1000}s before next file (rate limiting)`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.rateLimiting.delayBetweenFilesMs));
          }
        } catch (error) {
          userReporter.error(file.ObjectName, error);
        }
      }
    } else {
      userReporter.info("    No files found for explanation");
    }
  }

  // Shield scan (media files)
  if (scanConfig.shield) {
    const shieldFiles = filterFilesByType(folderObjects, 'shield');

    if (shieldFiles.length > 0) {
      userReporter.info(`    Media files found: ${shieldFiles.length}`);

      for (const shieldFile of shieldFiles) {
        try {
          const fileUrl = buildFileUrl(shieldFile.ObjectName);
          const urlHash = computeContentHash(fileUrl);

          if (!noCache && cacheManager.checkScan(urlHash, 'shield')) {
            userReporter.info(`  ${shieldFile.ObjectName}: ARACHNID SHIELD OK (cached)`);

            const cachedResponse = await cacheManager.readScanResponse(urlHash, 'shield');
            if (userReporter.verbose && cachedResponse) {
              userReporter.verboseInfo(`        Cached ARACHNID SHIELD Response:\n${cachedResponse}`);
            }
            continue;
          }

          const scanResult = await scanImageWithArachnidShieldFromUrl(fileUrl, userReporter);

          if (scanResult.status === 'ok' && scanResult.data.is_match) {
            const classificationDetails = scanResult.data.classification ? `Classification: ${scanResult.data.classification}` : 'No classification provided.';
            userReporter.violation(shieldFile.ObjectName, 'ARACHNID SHIELD CSAM', classificationDetails);
          } else if (scanResult.status === 'ok') {
            userReporter.ok(shieldFile.ObjectName, 'ARACHNID SHIELD');
            cacheManager.saveScan(urlHash, 'shield', JSON.stringify(scanResult));
          } else {
            userReporter.error(shieldFile.ObjectName, scanResult.data);
          }
        } catch (error) {
          userReporter.error(shieldFile.ObjectName, error);
        }
      }
    } else {
      userReporter.info("    No media files found");
    }
  }

  // Output username if violations-only mode and this user had violations
  if (reporter.violationsOnly && userHasViolations) {
    console.log(`. ${user.ObjectName}/`);
  }

  userReporter.info("");
  return userHasViolations;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main() {
  // Pre-check for help
  if (Bun.argv.includes('--help')) {
    showHelp();
    process.exit(0);
  }

  // Parse arguments
  const { values: args } = parseArgs({
    args: Bun.argv.slice(2),
    options: CONFIG.cli.argsConfig,
    strict: true
  });

  // Handle help
  if (args.help) {
    showHelp();
    return;
  }

  // Handle list-users
  if (args['list-users']) {
    await listUsers();
    return;
  }

  // Determine which scans to run
  const anyScanFlags = args.shield || args.safeguard || args.guard || args.explain;
  const scanConfig = {
    shield: !anyScanFlags || args.shield,
    safeguard: !anyScanFlags || args.safeguard,
    guard: !anyScanFlags || args.guard,
    explain: !!args.explain
  };

  // Setup reporter
  const reporter = setupConsoleDepthAndReporter(args);

  console.log(`Fetching contents of storage zone: ${STORAGE_ZONE_NAME}\n`);

  // Get user folders
  const userFolders = await getUserFolders(args.user);

  if (userFolders.length === 0) {
    console.log("No username folders found.");
    return;
  }

  if (!args['violations-only']) {
    console.log("Username Folders (Directories):");
    console.log("===============================");
  }

  // Scan each user
  for (const user of userFolders) {
    await scanUser(user, reporter, scanConfig, args['no-cache']);
  }
}

// ============================================================================
// SCRIPT EXECUTION
// ============================================================================

if (process.argv[1] === import.meta.path) {
  main();
}
