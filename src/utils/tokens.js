function dataView(array) {
  return new DataView(array.buffer, array.byteOffset);
}

export const INT16_BE = {
  len: 2,
  get(array, offset) {
    return dataView(array).getInt16(offset);
  },
  put(array, offset, value) {
    dataView(array).setInt16(offset, value);
    return offset + 2;
  },
};

export const UINT32_BE = {
  len: 4,

  get(array, offset) {
    return dataView(array).getUint32(offset);
  },

  put(array, offset, value) {
    dataView(array).setUint32(offset, value);
    return offset + 4;
  },
};

export class Uint8ArrayType {
  constructor(len) {
    this.len = len;
  }

  get(array, offset) {
    return array.subarray(offset, offset + this.len);
  }
}

export class StringType {
  constructor(len, encoding) {
    this.textDecoder = new TextDecoder(encoding);
    this.len = len;
  }

  get(uint8Array, offset) {
    return this.textDecoder.decode(uint8Array.subarray(offset, offset + this.len));
  }
}
