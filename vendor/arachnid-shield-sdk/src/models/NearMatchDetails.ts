import { Media } from './Media';

/**
 * A collection of images found in Arachnid Shield's database that were a near match (based on perceptual hashing) to the scanned image.
 */
export interface NearMatchDetails extends Media {
  /**
   * The time, in seconds, in the submitted video file where the match was found. For still images this will be 0.
   */
  timestamp: number;
}
