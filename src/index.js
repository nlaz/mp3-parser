import {  FrameHeader } from "./header.js";
import { INT16_BE, Uint8ArrayType } from "./utils/tokens.js";
import { EndOfStreamError } from "./tokenizer.js";
import { InfoTagHeaderTag, LameEncoderVersion, readXingHeader } from "./utils/xing.js";
import { fromFile } from "./tokenizer.js";

const MAX_PEEK_LENGTH = 1024;
const MIN_SYNC_PEEK_LENGTH = 163;
const SYNC_BYTE_MASK = 0xe0;
const FRAME_HEADER_LENGTH = 4;

export class Mp3Parser {
  constructor() {
    this.frameCount = 0;
    this.syncFrameCount = -1;
    this.bitrates = [];
    this.offset = 0;
    this.frameSize = 0;
    this.calculateEofDuration = false;
    this.samplesPerFrame = null;
    this.bufferFrameHeader = new Uint8Array(4);
    this.metadata = {};
    this.tokenizer = null;
    this.syncPeek = {
      buf: new Uint8Array(MAX_PEEK_LENGTH),
      len: 0,
    };
  }

  async parse(filePath) {
    try {
      let quit = false;
      this.tokenizer = await fromFile(filePath);
      while (!quit) {
        await this.sync();
        quit = await this.parseCommonMpegHeader();
      }
    } catch (err) {
      if (err instanceof EndOfStreamError) {
        this.handleEndOfStreamError();
      } else {
        throw err;
      }
    } finally {
      await this.tokenizer?.close();
    }
    return this.metadata;
  }

  handleEndOfStreamError() {
    if (this.calculateEofDuration && this.samplesPerFrame !== null) {
      const numberOfSamples = this.frameCount * this.samplesPerFrame;
      this.setFormat("numberOfSamples", numberOfSamples);

      const { sampleRate } = this.metadata;
      if (sampleRate) {
        const duration = numberOfSamples / sampleRate;
        this.setFormat("duration", duration);
      }
    }
  }

  async sync() {
    let gotFirstSync = false;

    while (true) {
      let bufferOffset = 0;
      this.syncPeek.len = await this.tokenizer.peekBuffer(this.syncPeek.buf, {
        length: MAX_PEEK_LENGTH,
        mayBeLess: true,
      });
      if (this.syncPeek.len <= MIN_SYNC_PEEK_LENGTH) {
        throw new EndOfStreamError();
      }
      while (true) {
        if (gotFirstSync && (this.syncPeek.buf[bufferOffset] & SYNC_BYTE_MASK) === SYNC_BYTE_MASK) {
          await this.handleSync(bufferOffset);
          return;
        }

        gotFirstSync = false;
        bufferOffset = this.syncPeek.buf.indexOf(FrameHeader.SyncByte1, bufferOffset);

        if (bufferOffset === -1) {
          if (this.syncPeek.len < this.syncPeek.buf.length) {
            throw new EndOfStreamError();
          }
          await this.tokenizer.ignore(this.syncPeek.len);
          break;
        }
        bufferOffset++;
        gotFirstSync = true;
      }
    }
  }

  async handleSync(bufferOffset) {
    this.bufferFrameHeader[0] = FrameHeader.SyncByte1;
    this.bufferFrameHeader[1] = this.syncPeek.buf[bufferOffset];
    await this.tokenizer.ignore(bufferOffset);

    if (this.syncFrameCount === this.frameCount) {
      this.frameCount = 0;
      this.frameSize = 0;
    }
    this.syncFrameCount = this.frameCount;
  }

  async parseCommonMpegHeader() {
    const header = await this.readFrameHeader();
    await this.tokenizer.ignore(3);

    this.updateMetadataFormat(header);

    this.frameCount++;
    return this.parseAudioFrameHeader(header);
  }

  async readFrameHeader() {
    await this.tokenizer.peekBuffer(this.bufferFrameHeader, {
      offset: 1,
      length: 3,
    });

    try {
      return new FrameHeader(this.bufferFrameHeader, 0);
    } catch (err) {
      await this.tokenizer.ignore(1);
      throw err;
    }
  }

  calculateFrameSize(header, samplesPerFrame, slotSize) {
    const bps = samplesPerFrame / 8.0;
    if (header.bitrate !== null && header.samplingRate != null) {
      const fsize = (bps * header.bitrate) / header.samplingRate + (header.padding ? slotSize : 0);
      this.frameSize = Math.floor(fsize);
    }
  }

  async handleFirstFrame() {
    this.offset = FRAME_HEADER_LENGTH;
    await this.skipSideInformation();
    return false;
  }

  handleThirdFrame(samplesPerFrame) {
    if (this.areAllSame(this.bitrates)) {
      this.samplesPerFrame = samplesPerFrame;
      return !!this.tokenizer.fileInfo.size;
    }

    return true;
  }

  async parseAudioFrameHeader(header) {
    this.updateAudioMetadata(header);

    const slot_size = header.calcSlotSize();
    if (slot_size === null) {
      throw new Error("invalid slot_size");
    }

    const samplesPerFrame = header.calcSamplesPerFrame();
    this.calculateFrameSize(header, samplesPerFrame, slot_size);

    this.audioFrameHeader = header;
    if (header.bitrate !== null) {
      this.bitrates.push(header.bitrate);
    }

    // xtra header only exists in first frame
    if (this.frameCount === 1) {
      return this.handleFirstFrame();
    }

    if (this.frameCount === 3) {
      return this.handleThirdFrame(samplesPerFrame);
    }

    return this.processFrameData(header);
  }

  async parseCrc() {
    await this.tokenizer.readNumber(INT16_BE);
    this.offset += 2;
    return this.skipSideInformation();
  }

  async skipSideInformation() {
    if (this.audioFrameHeader) {
      const sideinfoLength = this.audioFrameHeader.calculateSideInfoLength();
      if (sideinfoLength !== null) {
        await this.tokenizer.readToken(new Uint8ArrayType(sideinfoLength));
        this.offset += sideinfoLength;
        await this.readXtraInfoHeader();
        return;
      }
    }
  }

  async processFrameData(header) {
    this.offset = 4;
    if (header.isProtectedByCRC) {
      return this.parseCrc();
    }
    await this.skipSideInformation();
    return false;
  }

  async readXtraInfoHeader() {
    const headerTag = await this.tokenizer.readToken(InfoTagHeaderTag);
    this.offset += InfoTagHeaderTag.len; // 12

    if (headerTag === "Info" || headerTag === "Xing") {
      return this.readXingInfoHeader();
    } else if (headerTag === "LAME") {
      if (this.frameSize !== null && this.frameSize >= this.offset + LameEncoderVersion.len) {
        this.offset += LameEncoderVersion.len;
        await this.skipFrameData(this.frameSize - this.offset);
        return null;
      }
    }

    const frameDataLeft = this.frameSize - this.offset;
    if (frameDataLeft >= 0) {
      await this.skipFrameData(frameDataLeft);
    }
    return null;
  }

  async readXingInfoHeader() {
    const offset = this.tokenizer.position;
    const infoTag = await readXingHeader(this.tokenizer);
    this.offset += this.tokenizer.position - offset;

    if (infoTag.streamSize && this.audioFrameHeader && infoTag.numFrames !== null) {
      const duration = this.audioFrameHeader.calcDuration(infoTag.numFrames);
      this.setFormat("duration", duration);
      return infoTag;
    }

    // frames field is not present
    const frameDataLeft = this.frameSize - this.offset;

    await this.skipFrameData(frameDataLeft);
    return infoTag;
  }

  async skipFrameData(frameDataLeft) {
    if (frameDataLeft < 0) {
      throw new Error("frame-data-left cannot be negative");
    }
    await this.tokenizer.ignore(frameDataLeft);
  }

  updateMetadataFormat(header) {
    this.setFormat("container", header.container);
    this.setFormat("codec", header.codec);
    this.setFormat("sampleRate", header.samplingRate);
  }

  updateAudioMetadata(header) {
    this.setFormat("numberOfChannels", header.channelMode === "mono" ? 1 : 2);
    this.setFormat("bitrate", header.bitrate);
  }

  areAllSame(array) {
    const first = array[0];
    return array.every((element) => {
      return element === first;
    });
  }

  setFormat(key, value) {
    this.metadata[key] = value;
  }
}
