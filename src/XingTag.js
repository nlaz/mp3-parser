import { StringType, UINT32_BE, UINT8, UINT16_BE } from "token-types";
import { isBitSet, getBitAllignedNumber } from "./Util.js";

/**
 * Info Tag: Xing, LAME
 */
export const InfoTagHeaderTag = new StringType(4, "ascii");

/**
 * LAME TAG value
 * Did not find any official documentation for this
 * Value e.g.: "3.98.4"
 */
export const LameEncoderVersion = new StringType(6, "ascii");

/**
 * Info Tag
 * Ref: http://gabriel.mp3-tech.org/mp3infotag.html
 */
export const XingHeaderFlags = {
  len: 4,
  get: (buf, off) => {
    return {
      frames: isBitSet(buf, off, 31),
      bytes: isBitSet(buf, off, 30),
      toc: isBitSet(buf, off, 29),
      vbrScale: isBitSet(buf, off, 28),
    };
  },
};

// /**
//  * XING Header Tag
//  * Ref: http://gabriel.mp3-tech.org/mp3infotag.html
//  */
export async function readXingHeader(tokenizer) {
  const flags = await tokenizer.readToken(XingHeaderFlags);
  const xingInfoTag = { numFrames: null, streamSize: null, vbrScale: null };
  if (flags.frames) {
    xingInfoTag.numFrames = await tokenizer.readToken(Token.UINT32_BE);
  }
  if (flags.bytes) {
    xingInfoTag.streamSize = await tokenizer.readToken(Token.UINT32_BE);
  }
  if (flags.toc) {
    xingInfoTag.toc = new Uint8Array(100);
    await tokenizer.readBuffer(xingInfoTag.toc);
  }
  if (flags.vbrScale) {
    xingInfoTag.vbrScale = await tokenizer.readToken(Token.UINT32_BE);
  }
  const lameTag = await tokenizer.peekToken(new Token.StringType(4, "ascii"));
  if (lameTag === "LAME") {
    await tokenizer.ignore(4);
    xingInfoTag.lame = {
      version: await tokenizer.readToken(new Token.StringType(5, "ascii")),
    };
    const match = xingInfoTag.lame.version.match(/\d+.\d+/g);
    if (match !== null) {
      const majorMinorVersion = match[0]; // e.g. 3.97
      const version = majorMinorVersion
        .split(".")
        .map((n) => Number.parseInt(n, 10));
      if (version[0] >= 3 && version[1] >= 90) {
        xingInfoTag.lame.extended =
          await tokenizer.readToken(ExtendedLameHeader);
      }
    }
  }
  return xingInfoTag;
}

export const ExtendedLameHeader = {
  len: 27,
  get: (buf, off) => {
    const track_peak = UINT32_BE.get(buf, off + 2);
    return {
      revision: getBitAllignedNumber(buf, off, 0, 4),
      vbr_method: getBitAllignedNumber(buf, off, 4, 4),
      lowpass_filter: 100 * UINT8.get(buf, off + 1),
      track_peak: track_peak === 0 ? null : track_peak / 2 ** 23,
      track_gain: ReplayGain.get(buf, 6),
      album_gain: ReplayGain.get(buf, 8),
      music_length: UINT32_BE.get(buf, off + 20),
      music_crc: UINT8.get(buf, off + 24),
      header_crc: UINT16_BE.get(buf, off + 24),
    };
  },
};

/**
 * Replay Gain Data Format
 *
 * https://github.com/Borewit/music-metadata/wiki/Replay-Gain-Data-Format
 */
export const ReplayGain = {
  len: 2,
  get: (buf, off) => {
    const gain_type = getBitAllignedNumber(buf, off, 0, 3);
    const sign = getBitAllignedNumber(buf, off, 6, 1);
    const gain_adj = getBitAllignedNumber(buf, off, 7, 9) / 10.0;
    if (gain_type > 0) {
      return {
        type: getBitAllignedNumber(buf, off, 0, 3),
        origin: getBitAllignedNumber(buf, off, 3, 3),
        adjustment: sign ? -gain_adj : gain_adj,
      };
    }
    return undefined;
  },
};
