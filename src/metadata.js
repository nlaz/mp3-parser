export class Metadata {
  constructor() {
    this.format = {};
  }

  setFormat(key, value) {
    this.format[key] = value;

    if (this.opts?.observer) {
      this.opts.observer({
        metadata: this,
        tag: { type: "format", id: key, value },
      });
    }
  }
}
