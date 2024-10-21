export class BasicParser {
  constructor(metadata, tokenizer, options) {
    this.metadata = metadata;
    this.tokenizer = tokenizer;
    this.options = options;
  }

  async parse() {
    throw new Error('parse() method must be implemented by subclass');
  }
}
