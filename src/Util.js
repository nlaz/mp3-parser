
/**
 * Read bit-aligned number start from buffer
 * Total offset in bits = byteOffset * 8 + bitOffset
 * @param source Byte buffer
 * @param byteOffset Starting offset in bytes
 * @param bitOffset Starting offset in bits: 0 = lsb
 * @param len Length of number in bits
 * @return Decoded bit aligned number
 */
export function getBitAllignedNumber(source, byteOffset, bitOffset, len) {
  const byteOff = byteOffset + ~~(bitOffset / 8);
  const bitOff = bitOffset % 8;
  let value = source[byteOff];
  value &= 0xff >> bitOff;
  const bitsRead = 8 - bitOff;
  const bitsLeft = len - bitsRead;
  if (bitsLeft < 0) {
    value >>= (8 - bitOff - len);
  } else if (bitsLeft > 0) {
    value <<= bitsLeft;
    value |= getBitAllignedNumber(source, byteOffset, bitOffset + bitsRead, bitsLeft);
  }
  return value;
}

/**
 * Read bit-aligned number start from buffer
 * Total offset in bits = byteOffset * 8 + bitOffset
 * @param source Byte Uint8Array
 * @param byteOffset Starting offset in bytes
 * @param bitOffset Starting offset in bits: 0 = most significant bit, 7 is the least significant bit
 * @return True if bit is set
 */
export function isBitSet(source, byteOffset, bitOffset) {
  return getBitAllignedNumber(source, byteOffset, bitOffset, 1) === 1;
}

export function stripNulls(str) {
  str = str.replace(/^\x00+/g, '');
  str = str.replace(/\x00+$/g, '');
  return str;
}

export function trimRightNull(x) {
  const pos0 = x.indexOf('\0');
  return pos0 === -1 ? x : x.substr(0, pos0);
}

export function getBit(buf, off, bit) {
  return (buf[off] & (1 << bit)) !== 0;
}

/**
 * Decode string
 */
export function decodeString(uint8Array, encoding) {
  // annoying workaround for a double BOM issue
  // https://github.com/leetreveil/musicmetadata/issues/84
  if (uint8Array[0] === 0xFF && uint8Array[1] === 0xFE) { // little endian
    return decodeString(uint8Array.subarray(2), encoding);
  }if (encoding === 'utf-16le' && uint8Array[0] === 0xFE && uint8Array[1] === 0xFF) {
    // BOM, indicating big endian decoding
    if ((uint8Array.length & 1) !== 0)
      throw new FieldDecodingError('Expected even number of octets for 16-bit unicode string');
    return decodeString(swapBytes(uint8Array), encoding);
  }
  return new StringType(uint8Array.length, encoding).get(uint8Array, 0);
}

/**
 * Found delimiting zero in uint8Array
 * @param uint8Array Uint8Array to find the zero delimiter in
 * @param start Offset in uint8Array
 * @param end Last position to parse in uint8Array
 * @param encoding The string encoding used
 * @return Absolute position on uint8Array where zero found
 */
export function findZero(uint8Array, start, end, encoding) {
  let i = start;
  if (encoding === 'utf-16le') {
    while (uint8Array[i] !== 0 || uint8Array[i + 1] !== 0) {
      if (i >= end) return end;
      i += 2;
    }
    return i;
  }
    while (uint8Array[i] !== 0) {
      if (i >= end) return end;
      i++;
    }
    return i;
}
