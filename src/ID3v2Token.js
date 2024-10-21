import { UINT16_BE, UINT32_BE, INT8, UINT8, StringType } from 'token-types';
import { getBit } from './Util.js';

/**
 * The picture type according to the ID3v2 APIC frame
 * Ref: http://id3.org/id3v2.3.0#Attached_picture
 */
export const AttachedPictureType = {
  'Other': 0,
  "32x32 pixels 'file icon' (PNG only)": 1,
  'Other file icon': 2,
  'Cover (front)': 3,
  'Cover (back)': 4,
  'Leaflet page': 5,
  'Media (e.g. label side of CD)': 6,
  'Lead artist/lead performer/soloist': 7,
  'Artist/performer': 8,
  'Conductor': 9,
  'Band/Orchestra': 10,
  'Composer': 11,
  'Lyricist/text writer': 12,
  'Recording Location': 13,
  'During recording': 14,
  'During performance': 15,
  'Movie/video screen capture': 16,
  'A bright coloured fish': 17,
  'Illustration': 18,
  'Band/artist logotype': 19,
  'Publisher/Studio logotype': 20
}

export const ExtendedHeader = {
  len: 10,

  get: (buf, off) => {
    return {
      // Extended header size
      size: UINT32_BE.get(buf, off),
      // Extended Flags
      extendedFlags: UINT16_BE.get(buf, off + 4),
      // Size of padding
      sizeOfPadding: UINT32_BE.get(buf, off + 6),
      // CRC data present
      crcDataPresent: getBit(buf, off + 4, 31)
    };
  }
};

/**
 * 28 bits (representing up to 256MB) integer, the msb is 0 to avoid 'false syncsignals'.
 * 4 * %0xxxxxxx
 */
export const UINT32SYNCSAFE = {
  get: (buf, off) => {
    return buf[off + 3] & 0x7f | ((buf[off + 2]) << 7) |
      ((buf[off + 1]) << 14) | ((buf[off]) << 21);
  },
  len: 4
};

/**
 * ID3v2 header
 * Ref: http://id3.org/id3v2.3.0#ID3v2_header
 * ToDo
 */
export const ID3v2Header = {
  len: 10,

  get: (buf, off) => {
    return {
      // ID3v2/file identifier   "ID3"
      fileIdentifier: new StringType(3, 'ascii').get(buf, off),
      // ID3v2 versionIndex
      version: {
        major: INT8.get(buf, off + 3),
        revision: INT8.get(buf, off + 4)
      },
      // ID3v2 flags
      flags: {
        // Unsynchronisation
        unsynchronisation: getBit(buf, off + 5, 7),
        // Extended header
        isExtendedHeader: getBit(buf, off + 5, 6),
        // Experimental indicator
        expIndicator: getBit(buf, off + 5, 5),
        footer: getBit(buf, off + 5, 4)
      },
      size: UINT32SYNCSAFE.get(buf, off + 6)
    };
  }
};

export const TextEncodingToken = {
  len: 1,

  get: (uint8Array, off) => {
    switch (uint8Array[off]) {
      case 0x00:
        return {encoding: 'latin1'}; // binary
      case 0x01:
        return {encoding: 'utf-16le', bom: true};
      case 0x02:
        return {encoding: 'utf-16le', bom: false};
      case 0x03:
        return {encoding: 'utf8', bom: false};
      default:
        return {encoding: 'utf8', bom: false};
    }
  }
};

/**
 * Used to read first portion of `SYLT` frame
 */
export const TextHeader = {
  len: 4,

  get: (uint8Array, off) => {
    return {
      encoding: TextEncodingToken.get(uint8Array, off),
      language: new StringType(3, 'latin1').get(uint8Array, off + 1)
    };
  }
};

/**
 * Used to read first portion of `SYLT` frame
 */
export const SyncTextHeader = {
  len: 6,

  get: (uint8Array, off) => {
    const text = TextHeader.get(uint8Array, off);
    return {
      encoding: text.encoding,
      language: text.language,
      timeStampFormat: UINT8.get(uint8Array, off + 4),
      contentType: UINT8.get(uint8Array, off + 5)
    };
  }
};
