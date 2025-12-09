import { readFile, statSync } from 'fs';
import mime from 'mime';
import {
  ScanMediaFromUrl,
  ScannedMedia,
  ScanMediaViaBytesRequest,
  ScannedPdqHashes,
  MediaClassification,
} from './models';
import { Blob } from 'buffer';
import axios from 'axios';

const ARACHNID_SHIELD_BASE_URL: string = 'https://shield.projectarachnid.ca/';

/**
 * The type of response returned from the Arachnid Shield API.
 */
export type ArachnidShieldResponse<T> = { status: 'ok'; data: T } | { status: 'err'; data: string };

/**
 * Stores properties needed by the ArachnidShield client when interacting with the API.
 */
interface ArachnidShieldConfig {
  username: string; // The username. If you don't already have it, contact us.
  password: string; // The password. If you don't already have it, contact us.
  readonly basePath: string;
}

/**
 * A client for the Arachnid Shield API that offers scanning of media for CSAM
 * or other material that is harmful to children.
 */
export class ArachnidShield {
  readonly configuration: ArachnidShieldConfig;
  readonly headers: Record<string, string>;

  constructor(username: string, password: string, baseUrl?: string) {
    this.configuration = {
      username,
      password,
      basePath: baseUrl || ARACHNID_SHIELD_BASE_URL,
    };
    this.headers = {
      Authorization: 'Basic ' + btoa(this.configuration.username + ':' + this.configuration.password),
    };
  }

  /**
   * Scan a given media for CSAM (image or video) based on its contents (i.e. raw bytes).
   *
   * @param contents The raw bytes of the media to scan.
   * @param mimeType The mime type of the media to scan.
   * @param sizeInBytes The size of the media to scan in bytes.
   * @returns `ScannedMedia` if the interaction was successful, `ErrorDetail` otherwise.
   */
  public async scanMediaFromBytes(
    contents: Uint8Array | Blob,
    mimeType?: string,
    sizeInBytes?: number,
  ): Promise<ArachnidShieldResponse<ScannedMedia>> {
    const requestData: ScanMediaViaBytesRequest = {
      body: contents instanceof Uint8Array ? new Blob([contents], { type: mimeType }) : contents,
    };
    let computedMimeType: string = mimeType || '';
    if (contents instanceof Blob) {
      computedMimeType = contents.type;
    }

    const headers: any = {
      ...this.headers,
      'Content-Type': computedMimeType,
    };

    if (sizeInBytes) {
      headers['Content-Length'] = sizeInBytes;
    }

    try {
      const response = await axios.post<ScannedMedia>(
        new URL('/v1/media/', this.configuration.basePath).toString(),
        requestData.body,
        {
          headers,
        },
      );

      const data = response.data;
      data.is_match = data.classification !== null && data.classification !== MediaClassification.NoKnownMatch;

      return { status: 'ok', data };
    } catch (error: any) {
      return { status: 'err', data: error.response?.data.detail || error };
    }
  }

  /**
   * Scan a media (image or video) obtained via a URL for CSAM.
   * @param url The URL to fetch the media contents from.
   * @returns `ScannedMedia`
   */
  public async scanMediaFromUrl(url: URL | string): Promise<ArachnidShieldResponse<ScannedMedia>> {
    const requestData: ScanMediaFromUrl = {
      url: url instanceof URL ? url.toString() : url,
    };

    const headers = {
      ...this.headers,
      'Content-Type': 'application/json; charset=utf-8',
    };

    try {
      const response = await axios.post<ScannedMedia>(
        new URL('/v1/url/', this.configuration.basePath).toString(),
        JSON.stringify(requestData),
        {
          headers,
        },
      );
      const data = response.data;
      data.is_match = data.classification !== null && data.classification !== MediaClassification.NoKnownMatch;
      return { status: 'ok', data };
    } catch (error: any) {
      return { status: 'err', data: error.response?.data.detail || error };
    }
  }

  /**
   * Scan a media (image or video) stored at the provided filepath for CSAM.
   *
   * @param filepath The path to the media to scan.
   * @returns `ScannedMedia`
   */
  public async scanMediaFromFile(filepath: string): Promise<ArachnidShieldResponse<ScannedMedia>> {
    let computedMimeType: string = 'application/octet-stream';
    const maybeMimeType = mime.getType(filepath);
    if (maybeMimeType) {
      computedMimeType = maybeMimeType;
    }
    let fileSizeInBytes;
    try {
      fileSizeInBytes = statSync(filepath).size;
    } catch (err) {
      // Proceed anyway and let the server figure out the size of the contents.
    }
    const readingFile: Promise<Blob> = new Promise((resolve, reject) => {
      readFile(filepath, (err, filedata) => {
        if (err) {
          return reject(err.toString());
        } else {
          return resolve(new Blob([filedata], { type: computedMimeType }));
        }
      });
    });
    let completed;
    try {
      completed = await readingFile;
    } catch (err: any) {
      return { status: 'err', data: err };
    }
    return await this.scanMediaFromBytes(completed, computedMimeType, fileSizeInBytes);
  }

  /**
   * Scan the provided PDQ Hashes to determine if they match a CSAM media.
   * @param pdqHashes An array of base64 encoded PDQ hashes to scan.
   * @returns `ScannedPDQHashes`
   */
  public async scanPdqHashes(pdqHashes: string[]): Promise<ArachnidShieldResponse<ScannedPdqHashes>> {
    const headers: any = {
      ...this.headers,
      'Content-Type': 'application/json; charset=utf-8',
    };
    try {
      const response = await axios.post<ScannedPdqHashes>(
        new URL('/v1/pdq/', this.configuration.basePath).toString(),
        { hashes: pdqHashes },
        {
          headers,
        },
      );

      return { status: 'ok', data: response.data };
    } catch (error: any) {
      return { status: 'err', data: error.response?.data.detail || error };
    }
  }
}
