import fs from "node:fs/promises";

export class EndOfStreamError extends Error {
  constructor() {
    super("End-of-stream");
  }
}

export class FileTokenizer {
  constructor(fileHandle, options) {
    this.fileInfo = options?.fileInfo ?? {};
    this.fileHandle = fileHandle;
    this.position = 0;
    this.numBuffer = new Uint8Array(8);
    this.closed = false;
  }

  /**
   * Read buffer from file
   * @param uint8Array - Uint8Array to write result to
   * @param options - Read behaviour options
   * @returns Promise number of bytes read
   */
  async readBuffer(uint8Array, options) {
    const normOptions = this.normalizeOptions(uint8Array, options);
    this.position = normOptions.position;
    if (normOptions.length === 0) return 0;
    const res = await this.fileHandle.read(uint8Array, normOptions.offset, normOptions.length, normOptions.position);
    this.position += res.bytesRead;
    if (res.bytesRead < normOptions.length && (!options || !options.mayBeLess)) {
      throw new EndOfStreamError();
    }
    return res.bytesRead;
  }

  /**
   * Peek buffer from file
   * @param uint8Array - Uint8Array (or Buffer) to write data to
   * @param options - Read behaviour options
   * @returns Promise number of bytes read
   */
  async peekBuffer(uint8Array, options) {
    const normOptions = this.normalizeOptions(uint8Array, options);

    const res = await this.fileHandle.read(uint8Array, normOptions.offset, normOptions.length, normOptions.position);
    if (!normOptions.mayBeLess && res.bytesRead < normOptions.length) {
      throw new EndOfStreamError();
    }
    return res.bytesRead;
  }

  /**
   * Read a token from the tokenizer-stream
   * @param token - The token to read
   * @param position - If provided, the desired position in the tokenizer-stream
   * @returns Promise with token data
   */
  async readToken(token, position = this.position) {
    const uint8Array = new Uint8Array(token.len);
    const len = await this.readBuffer(uint8Array, { position });
    if (len < token.len) throw new EndOfStreamError();
    return token.get(uint8Array, 0);
  }

  /**
   * Peek a token from the tokenizer-stream.
   * @param token - Token to peek from the tokenizer-stream.
   * @param position - Offset where to begin reading within the file. If position is null, data will be read from the current file position.
   * @returns Promise with token data
   */
  async peekToken(token, position = this.position) {
    const uint8Array = new Uint8Array(token.len);
    const len = await this.peekBuffer(uint8Array, { position });
    if (len < token.len) throw new EndOfStreamError();
    return token.get(uint8Array, 0);
  }

  normalizeOptions(uint8Array, options) {
    if (options && options.position !== undefined && options.position < this.position) {
      throw new Error("`options.position` must be equal or greater than `tokenizer.position`");
    }

    if (options) {
      return {
        mayBeLess: options.mayBeLess === true,
        offset: options.offset ? options.offset : 0,
        length: options.length ? options.length : uint8Array.length - (options.offset ? options.offset : 0),
        position: options.position ? options.position : this.position,
      };
    }

    return {
      mayBeLess: false,
      offset: 0,
      length: uint8Array.length,
      position: this.position,
    };
  }

  async close() {
    this.closed = true;
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  /**
   * Ignore number of bytes, advances the pointer in under tokenizer-stream.
   * @param length - Number of bytes to ignore
   * @return resolves the number of bytes ignored, equals length if this available, otherwise the number of bytes available
   */
  async ignore(length) {
    if (this.fileInfo.size !== undefined) {
      const bytesLeft = this.fileInfo.size - this.position;
      if (length > bytesLeft) {
        this.position += bytesLeft;
        return bytesLeft;
      }
    }
    this.position += length;
    return length;
  }
}

export async function fromFile(sourceFilePath) {
  const fileHandle = await fs.open(sourceFilePath, "r");
  const stat = await fileHandle.stat();
  return new FileTokenizer(fileHandle, { fileInfo: { path: sourceFilePath, size: stat.size } });
}
