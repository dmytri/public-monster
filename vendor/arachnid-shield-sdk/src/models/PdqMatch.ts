import { NearMatchDetails } from './NearMatchDetails';
import { MatchType, MediaClassification } from './MediaClassification';

/**
 * The details about the match for a queried PDQ hash.
 */
export interface PdqMatch {
  /**
   * The classification assigned to the matched media for the PDQ.
   */
  classification: MediaClassification;
  /**
   * The matching technology that was used to match the submitted media to the media in our database;
   * This is `null` if the classification is `no-known-match`.
   */
  match_type: MatchType | null;
  /**
   * Best matched image found in the Arachnid Shield database that were similar to the PDQ hash.
   */
  near_match_details: NearMatchDetails | null;
}