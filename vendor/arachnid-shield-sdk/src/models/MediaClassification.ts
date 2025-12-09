/**
 * A non-exhaustive collection of categories that a media could be classified as.
 *
 * Note: Video files are classified based on their frames. So, if
 * any frame from a video matches a known image,
 * the video will be given that image's classification.
 *
 * If both `csam` and `harmful-abusive-material` frames are matched in
 * a single video, the classification with the higher severity, i.e. `csam` will be returned.
 *
 * ## Variants
 *
 * ### CSAM (`csam`)
 *
 * Child sexual abuse material, also known as "child pornography".
 *
 * ### Harmful Abusive Material (`harmful-abusive-material`)
 *
 * Content considered harmful to children includes all images or videos associated with
 * the abusive incident, nude or partially nude images or videos of children
 * that have become publicly available and are used in a sexualized context or
 * connected to sexual commentary.
 *
 * ### No Known Match (`no-known-match`)
 *
 * The media was not an exact match or a near match to any classified CSAM
 * or harmful/abusive material in our database.
 *
 */
export enum MediaClassification {
  CSAM = 'csam',
  HarmfulAbusiveMaterial = 'harmful-abusive-material',
  NoKnownMatch = 'no-known-match',
}

/**
 * The technology that was used to verify a match between two media.
 *
 * This indicates whether the submitted media matched media in our database
 * exactly (by cryptographic hash) or visually (by visual hash).
 *
 * ## Variants
 *
 * ### Exact (`exact`)
 *
 * An exact cryptographic hash match using SHA1.
 *
 * ### Near (`near`)
 *
 * A visual near-match using PhotoDNA.
 */
export enum MatchType {
  Near = 'near',
  Exact = 'exact',
}
