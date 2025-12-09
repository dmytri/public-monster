import { MediaClassification } from './MediaClassification';
import { Blob } from 'buffer';

export interface Media {
  /**
   * The base-32 representation of the SHA1 cryptographic hash of the media.
   */
  sha1_base32: string;
  /**
   * The base-16 (hexadecimal) representation of the SHA256 cryptographic hash of the media.
   */
  sha256_hex: string;
  /**
   * The classification assigned to this media.
   */
  classification: MediaClassification | null;

  /**
   * Whether this media is a match to a known CSAM or HarmfulToChildren media.
   */
  is_match: boolean | null;
}

/**
 * The request param object that can initiate a scan media request.
 */
export interface ScanMediaViaBytesRequest {
  body: Blob | null;
}
