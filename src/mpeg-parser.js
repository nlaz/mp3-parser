import { INT16_BE, Uint8ArrayType } from "token-types";
import { EndOfStreamError } from "strtok3";
import { InfoTagHeaderTag, LameEncoderVersion, readXingHeader } from "./xing-tags.js";
import { getBitAllignedNumber } from "./utils.js";
import { MpegFrameHeader } from "./mpeg-frame-header.js";

const maxPeekLen = 1024;

const FrameHeader = {
  len: 4,

  get: (buf, off) => {
    return new MpegFrameHeader(buf, off);
  },
};

function getVbrCodecProfile(vbrScale) {
  return `V${Math.floor((100 - vbrScale) / 10)}`;
}

export class MpegParser {
  constructor(metadata, tokenizer, options) {
    this.frameCount = 0;
    this.syncFrameCount = -1;
    this.countSkipFrameData = 0;
    this.totalDataLength = 0;
    this.bitrates = [];
    this.offset = 0;
    this.frame_size = 0;
    this.crc = null;
    this.calculateEofDuration = false;
    this.samplesPerFrame = null;
    this.buf_frame_header = new Uint8Array(4);
    this.mpegOffset = null;
    this.metadata = metadata;
    this.tokenizer = tokenizer;
    this.options = options;
    this.syncPeek = {
      buf: new Uint8Array(maxPeekLen),
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
        if (this.calculateEofDuration) {
          if (this.samplesPerFrame !== null) {
            const numberOfSamples = this.frameCount * this.samplesPerFrame;
            this.metadata.setFormat("numberOfSamples", numberOfSamples);
            if (this.metadata.format.sampleRate) {
              const duration = numberOfSamples / this.metadata.format.sampleRate;
              this.metadata.setFormat("duration", duration);
            }
          }
        }
      } else {
        throw err;
      }
    }
  }

  async sync() {
    let gotFirstSync = false;

    while (true) {
      let bo = 0;
      this.syncPeek.len = await this.tokenizer.peekBuffer(this.syncPeek.buf, {
        length: maxPeekLen,
        mayBeLess: true,
      });
      if (this.syncPeek.len <= 163) {
        throw new EndOfStreamError();
      }
      while (true) {
        if (gotFirstSync && (this.syncPeek.buf[bo] & 0xe0) === 0xe0) {
          this.buf_frame_header[0] = MpegFrameHeader.SyncByte1;
          this.buf_frame_header[1] = this.syncPeek.buf[bo];
          await this.tokenizer.ignore(bo);
          if (this.syncFrameCount === this.frameCount) {
            this.frameCount = 0;
            this.frame_size = 0;
          }
          this.syncFrameCount = this.frameCount;
          return; // sync
        }
        gotFirstSync = false;
        bo = this.syncPeek.buf.indexOf(MpegFrameHeader.SyncByte1, bo);
        if (bo === -1) {
          if (this.syncPeek.len < this.syncPeek.buf.length) {
            throw new EndOfStreamError();
          }
          await this.tokenizer.ignore(this.syncPeek.len);
          break; // continue with next buffer
        }
        ++bo;
        gotFirstSync = true;
      }
    }
  }

  async parseCommonMpegHeader() {
    if (this.frameCount === 0) {
      this.mpegOffset = this.tokenizer.position - 1;
    }

    await this.tokenizer.peekBuffer(this.buf_frame_header, {
      offset: 1,
      length: 3,
    });

    let header;
    try {
      header = FrameHeader.get(this.buf_frame_header, 0);
    } catch (err) {
      await this.tokenizer.ignore(1);
      if (err instanceof Error) {
        this.metadata.addWarning(`Parse error: ${err.message}`);
        return false; // sync
      }
      throw err;
    }
    await this.tokenizer.ignore(3);

    this.metadata.setFormat("container", header.container);
    this.metadata.setFormat("codec", header.codec);
    this.metadata.setFormat("lossless", false);
    this.metadata.setFormat("sampleRate", header.samplingRate);

    this.frameCount++;
    return header.version !== null && header.version >= 2 && header.layer === 0
      ? this.parseAdts(header)
      : this.parseAudioFrameHeader(header);
  }

  async parseAudioFrameHeader(header) {
    this.metadata.setFormat(
      "numberOfChannels",
      header.channelMode === "mono" ? 1 : 2,
    );
    this.metadata.setFormat("bitrate", header.bitrate);

    const slot_size = header.calcSlotSize();
    if (slot_size === null) {
      throw new Error("invalid slot_size");
    }

    const samples_per_frame = header.calcSamplesPerFrame();
    const bps = samples_per_frame / 8.0;
    if (header.bitrate !== null && header.samplingRate != null) {
      const fsize =
        (bps * header.bitrate) / header.samplingRate +
        (header.padding ? slot_size : 0);
      this.frame_size = Math.floor(fsize);
    }

    this.audioFrameHeader = header;
    if (header.bitrate !== null) {
      this.bitrates.push(header.bitrate);
    }

    // xtra header only exists in first frame
    if (this.frameCount === 1) {
      this.offset = FrameHeader.len;
      await this.skipSideInformation();
      return false;
    }

    if (this.frameCount === 3) {
      // the stream is CBR if the first 3 frame bitrates are the same
      if (this.areAllSame(this.bitrates)) {
        // Actual calculation will be done in finalize
        this.samplesPerFrame = samples_per_frame;
        this.metadata.setFormat("codecProfile", "CBR");
        if (this.tokenizer.fileInfo.size) return true; // Will calculate duration based on the file size
      } else if (this.metadata.format.duration) {
        return true; // We already got the duration, stop processing MPEG stream any further
      }
      if (!this.options.duration) {
        return true; // Enforce duration not enabled, stop processing entire stream
      }
    }

    // once we know the file is VBR attach listener to end of
    // stream so we can do the duration calculation when we
    // have counted all the frames
    if (this.options.duration && this.frameCount === 4) {
      this.samplesPerFrame = samples_per_frame;
      this.calculateEofDuration = true;
    }

    this.offset = 4;
    if (header.isProtectedByCRC) {
      await this.parseCrc();
      return false;
    }
    await this.skipSideInformation();
    return false;
  }

  async parseAdts(header) {
    const buf = new Uint8Array(3);
    await this.tokenizer.readBuffer(buf);
    header.frameLength += getBitAllignedNumber(buf, 0, 0, 11);
    this.totalDataLength += header.frameLength;
    this.samplesPerFrame = 1024;

    if (header.samplingRate !== null) {
      const framesPerSec = header.samplingRate / this.samplesPerFrame;
      const bytesPerFrame =
        this.frameCount === 0 ? 0 : this.totalDataLength / this.frameCount;
      const bitrate = 8 * bytesPerFrame * framesPerSec + 0.5;
      this.metadata.setFormat("bitrate", bitrate);
    }

    await this.tokenizer.ignore(
      header.frameLength > 7 ? header.frameLength - 7 : 1,
    );

    // Consume remaining header and frame data
    if (this.frameCount === 3) {
      this.metadata.setFormat("codecProfile", header.codecProfile);
      if (header.mp4ChannelConfig) {
        this.metadata.setFormat(
          "numberOfChannels",
          header.mp4ChannelConfig.length,
        );
      }
      if (this.options.duration) {
        this.calculateEofDuration = true;
      } else {
        return true; // Stop parsing after the third frame
      }
    }
    return false;
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

  async readXtraInfoHeader() {
    const headerTag = await this.tokenizer.readToken(InfoTagHeaderTag);
    this.offset += InfoTagHeaderTag.len; // 12

    switch (headerTag) {
      case "Info":
        this.metadata.setFormat("codecProfile", "CBR");
        return this.readXingInfoHeader();

      case "Xing": {
        const infoTag = await this.readXingInfoHeader();
        if (infoTag.vbrScale !== null) {
          const codecProfile = getVbrCodecProfile(infoTag.vbrScale);
          this.metadata.setFormat("codecProfile", codecProfile);
        }
        return null;
      }

      case "Xtra":
        break;

      case "LAME": {
        const version = await this.tokenizer.readToken(LameEncoderVersion);
        if (
          this.frame_size !== null &&
          this.frame_size >= this.offset + LameEncoderVersion.len
        ) {
          this.offset += LameEncoderVersion.len;
          this.metadata.setFormat("tool", `LAME ${version}`);
          await this.skipFrameData(this.frame_size - this.offset);
          return null;
        }
        this.metadata.addWarning("Corrupt LAME header");
        break;
      }
    }

    const frameDataLeft = this.frame_size - this.offset;
    if (frameDataLeft < 0) {
      this.metadata.addWarning(`Frame ${this.frameCount}corrupt: negative frameDataLeft`);
    } else {
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
    const frameDataLeft = this.frame_size - this.offset;

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
