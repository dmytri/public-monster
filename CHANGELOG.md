# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Enhanced 404 page with distance-based file suggestions
  - Added Levenshtein distance function to find similar filenames
  - Updated file filtering logic to suggest files that are similar in name when users mistype URLs
  - Improved user experience when encountering 404 errors