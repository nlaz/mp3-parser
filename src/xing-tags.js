import { StringType, UINT32_BE } from "token-types";
import { isBitSet } from "./utils.js";

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
    xingInfoTag.numFrames = await tokenizer.readToken(UINT32_BE);
  }
  if (flags.bytes) {
    xingInfoTag.streamSize = await tokenizer.readToken(UINT32_BE);
  }
  if (flags.toc) {
    xingInfoTag.toc = new Uint8Array(100);
    await tokenizer.readBuffer(xingInfoTag.toc);
  }
  if (flags.vbrScale) {
    xingInfoTag.vbrScale = await tokenizer.readToken(UINT32_BE);
  }
  const lameTag = await tokenizer.peekToken(new StringType(4, "ascii"));
  if (lameTag === "LAME") {
    await tokenizer.ignore(4);
    xingInfoTag.lame = {
      version: await tokenizer.readToken(new StringType(5, "ascii")),
    };
  }
  return xingInfoTag;
}
