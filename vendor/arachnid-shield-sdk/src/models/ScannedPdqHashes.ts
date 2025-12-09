import { PdqMatch } from './PdqMatch';

/**
 * A record of the matches for PDQ hashes that have been scanned by the
 * Arachnid Shield API.
 */
export interface ScannedPdqHashes {
  /**
   * A collection of the match details for scanned PDQ hashes.
   */
  scanned_hashes: Record<string, PdqMatch>;
}
