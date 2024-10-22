import { fileTypeFromBuffer } from 'file-type';

export class MetadataCollector {
  constructor() {
    this.format = {
      tagTypes: [],
    };
    this.native = {};
    this.quality = {
      warnings: []
    };
  }

  hasAny() {
    return Object.keys(this.native).length > 0;
  }

  setFormat(key, value) {
    this.format[key] = value;

    if (this.opts?.observer) {
      this.opts.observer({metadata: this, tag: {type: 'format', id: key, value}});
    }
  }

  async addTag(tagType, tagId, value) {
    if (!this.native[tagType]) {
      this.format.tagTypes.push(tagType);
      this.native[tagType] = [];
    }
    this.native[tagType].push({id: tagId, value});
  }

  addWarning(warning) {
    this.quality.warnings.push({message: warning});
  }
}
