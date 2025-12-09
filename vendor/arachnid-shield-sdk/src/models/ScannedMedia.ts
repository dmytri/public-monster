import { Media } from './Media';
import { MatchType } from './MediaClassification';
import { NearMatchDetails } from './NearMatchDetails';

/**
 * A record of a media (+ metadata) that has been scanned by the Arachnid Shield API
 * and potential any visual or cryptographic matches attached to it.
 */
export interface ScannedMedia extends Media {
  /**
   * The matching technology that was used to match the submitted media to the media in our database;
   * This is `null` if the classification is `no-known-match`.
   */
  match_type: MatchType | null;
  /**
   * The total size, in bytes, of the media that was scanned.
   */
  size_bytes: number;
  /**
   * An array of images found in the Arachnid Shield database that were visually similar to the scanned image.
   */
  near_match_details: NearMatchDetails[];
}
