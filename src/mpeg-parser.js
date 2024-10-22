import { INT16_BE, Uint8ArrayType } from "token-types";
import { EndOfStreamError } from "strtok3";
import {
  InfoTagHeaderTag,
  LameEncoderVersion,
  readXingHeader,
} from "./xing-tags.js";
import { MpegFrameHeader } from "./mpeg-frame-header.js";

const MAX_PEEK_LENGTH = 1024;
const MIN_SYNC_PEEK_LENGTH = 163;
const SYNC_BYTE_MASK = 0xe0;

const FrameHeader = {
  len: 4,

  get: (buf, off) => {
    return new MpegFrameHeader(buf, off);
  },
};

export class MpegParser {
  constructor(metadata, tokenizer, options) {
    this.frameCount = 0;
    this.syncFrameCount = -1;
    this.countSkipFrameData = 0;
    this.totalDataLength = 0;
    this.bitrates = [];
    this.offset = 0;
    this.frameSize = 0;
    this.crc = null;
    this.calculateEofDuration = false;
    this.samplesPerFrame = null;
    this.bufferFrameHeader = new Uint8Array(4);
    this.mpegOffset = null;
    this.metadata = metadata;
    this.tokenizer = tokenizer;
    this.options = options;
    this.syncPeek = {
      buf: new Uint8Array(MAX_PEEK_LENGTH),
      len: 0,
    };
  }

  async parse() {
    this.metadata.setFormat("lossless", false);

    try {
      let quit = false;
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
    }
  }

  handleEndOfStreamError() {
    if (this.calculateEofDuration && this.samplesPerFrame !== null) {
      const numberOfSamples = this.frameCount * this.samplesPerFrame;
      this.metadata.setFormat("numberOfSamples", numberOfSamples);

      const { sampleRate } = this.metadata.format;
      if (sampleRate) {
        const duration = numberOfSamples / sampleRate;
        this.metadata.setFormat("duration", duration);
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
        bufferOffset = this.syncPeek.buf.indexOf(MpegFrameHeader.SyncByte1, bufferOffset);

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
    this.bufferFrameHeader[0] = MpegFrameHeader.SyncByte1;
    this.bufferFrameHeader[1] = this.syncPeek.buf[bufferOffset];
    await this.tokenizer.ignore(bufferOffset);

    if (this.syncFrameCount === this.frameCount) {
      this.frameCount = 0;
      this.frameSize = 0;
    }
    this.syncFrameCount = this.frameCount;
  }

  async parseCommonMpegHeader() {
    if (this.frameCount === 0) {
      this.mpegOffset = this.tokenizer.position - 1;
    }

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
      return FrameHeader.get(this.bufferFrameHeader, 0);
    } catch (err) {
      await this.tokenizer.ignore(1);
      throw err;
    }
  }

  updateMetadataFormat(header) {
    this.metadata.setFormat("container", header.container);
    this.metadata.setFormat("codec", header.codec);
    this.metadata.setFormat("lossless", false);
    this.metadata.setFormat("sampleRate", header.samplingRate);
  }

  updateAudioMetadata(header) {
    this.metadata.setFormat("numberOfChannels", header.channelMode === "mono" ? 1 : 2);
    this.metadata.setFormat("bitrate", header.bitrate);
  }

  calculateFrameSize(header, samplesPerFrame, slotSize) {
    const bps = samplesPerFrame / 8.0;
    if (header.bitrate !== null && header.samplingRate != null) {
      const fsize = (bps * header.bitrate) / header.samplingRate + (header.padding ? slotSize : 0);
      this.frameSize = Math.floor(fsize);
    }
  }

  async handleFirstFrame() {
    this.offset = FrameHeader.len;
    await this.skipSideInformation();
    return false;
  }

  handleThirdFrame(samplesPerFrame) {
    // the stream is CBR if the first 3 frame bitrates are the same
    if (this.areAllSame(this.bitrates)) {
      // Actual calculation will be done in finalize
      this.samplesPerFrame = samplesPerFrame;
      this.metadata.setFormat("codecProfile", "CBR");
      return !!this.tokenizer.fileInfo.size; // Will calculate duration based on the file size
    }

    if (this.metadata.format.duration) {
      return true; // We already got the duration, stop processing MPEG stream any further
    }

    return !this.options.duration; // Enforce duration not enabled, stop processing entire stream
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

    console.log('this.options.duration', this.options);
    if (this.frameCount === 3) {
      console.log('here');
      return this.handleThirdFrame(samplesPerFrame);
    }
    console.log('here 2 frame count', this.frameCount);

    // once we know the file is VBR attach listener to end of
    // stream so we can do the duration calculation when we
    // have counted all the frames
    if (this.options.duration && this.frameCount === 4) {
      this.samplesPerFrame = samplesPerFrame;
      this.calculateEofDuration = true;
    }


    return this.processFrameData(header);
  }

  async parseCrc() {
    this.crc = await this.tokenizer.readNumber(INT16_BE);
    this.offset += 2;
    return this.skipSideInformation();
  }

  async skipSideInformation() {
    if (this.audioFrameHeader) {
      const sideinfo_length = this.audioFrameHeader.calculateSideInfoLength();
      if (sideinfo_length !== null) {
        await this.tokenizer.readToken(new Uint8ArrayType(sideinfo_length));
        // side information
        this.offset += sideinfo_length;
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

    switch (headerTag) {
      case "Info":
        return this.readXingInfoHeader();

      case "Xing":
        return this.readXingInfoHeader();

      case "LAME": {
        if (
          this.frameSize !== null &&
          this.frameSize >= this.offset + LameEncoderVersion.len
        ) {
          this.offset += LameEncoderVersion.len;
          await this.skipFrameData(this.frameSize - this.offset);
          return null;
        }
        break;
      }
      default:
        break;
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

    if (
      infoTag.streamSize &&
      this.audioFrameHeader &&
      infoTag.numFrames !== null
    ) {
      const duration = this.audioFrameHeader.calcDuration(infoTag.numFrames);
      this.metadata.setFormat("duration", duration);
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
    this.countSkipFrameData += frameDataLeft;
  }

  areAllSame(array) {
    const first = array[0];
    return array.every((element) => {
      return element === first;
    });
  }
}
