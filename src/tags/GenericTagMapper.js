export class CommonTagMapper {
  static maxRatingScore = 1;

  static toIntOrNull(str) {
    const cleaned = parseInt(str, 10);
    return isNaN(cleaned) ? null : cleaned;
  }

  static normalizeTrack(origVal) {
    const split = origVal.toString().split('/');
    return {
      no: parseInt(split[0], 10) || null,
      of: parseInt(split[1], 10) || null
    };
  }

  constructor(tagTypes, tagMap) {
    this.tagTypes = tagTypes;
    this.tagMap = tagMap;
  }

  mapGenericTag(tag, warnings) {
    tag = { id: tag.id, value: tag.value }; // clone object
    this.postMap(tag, warnings);
    const id = this.getCommonName(tag.id);
    return id ? { id, value: tag.value } : null;
  }

  getCommonName(tag) {
    return this.tagMap[tag];
  }

  postMap(tag, warnings) {
    return;
  }
}
