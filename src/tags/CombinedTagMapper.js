import { ID3v1TagMapper } from './ID3v1TagMapper.js';

export class CombinedTagMapper {
  constructor() {
    this.tagMappers = {};

    [new ID3v1TagMapper()].forEach(mapper => {
      this.registerTagMapper(mapper);
    });
  }

  /**
   * Convert native to generic (common) tags
   * @param {string} tagType - Originating tag format
   * @param {Object} tag - Native tag to map to a generic tag id
   * @param {Object} warnings - Warnings object
   * @return {Object|null} Generic tag result (output of this function)
   */
  mapTag(tagType, tag, warnings) {
    const tagMapper = this.tagMappers[tagType];
    if (tagMapper) {
      return this.tagMappers[tagType].mapGenericTag(tag, warnings);
    }
    throw new Error(`No generic tag mapper defined for tag-format: ${tagType}`);
  }

  registerTagMapper(genericTagMapper) {
    for (const tagType of genericTagMapper.tagTypes) {
      this.tagMappers[tagType] = genericTagMapper;
    }
  }
}
