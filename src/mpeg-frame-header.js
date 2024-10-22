import { getBitAllignedNumber, isBitSet } from "./utils.js";

const MPEG4 = {
  AudioObjectTypes: [
    "AAC Main",
    "AAC LC",
    "AAC SSR",
    "AAC LTP",
  ],

  SamplingFrequencies: [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350, null, null, -1,
  ],
};

const MPEG4_ChannelConfigurations = [
  undefined,
  ["front-center"],
  ["front-left", "front-right"],
  ["front-center", "front-left", "front-right"],
  ["front-center", "front-left", "front-right", "back-center"],
  ["front-center", "front-left", "front-right", "back-left", "back-right"],
  ["front-center", "front-left", "front-right", "back-left", "back-right", "LFE-channel"],
  ["front-center", "front-left", "front-right", "side-left", "side-right", "back-left", "back-right", "LFE-channel"],
];

export class MpegFrameHeader {
  static SyncByte1 = 0xff;
  static SyncByte2 = 0xe0;

  static VersionID = [2.5, null, 2, 1];
  static LayerDescription = [0, 3, 2, 1];
  static ChannelMode = ["stereo", "joint_stereo", "dual_channel", "mono"];

  static bitrate_index = {
    1: { 11: 32, 12: 32, 13: 32, 21: 32, 22: 8, 23: 8 },
    2: { 11: 64, 12: 48, 13: 40, 21: 48, 22: 16, 23: 16 },
    3: { 11: 96, 12: 56, 13: 48, 21: 56, 22: 24, 23: 24 },
    4: { 11: 128, 12: 64, 13: 56, 21: 64, 22: 32, 23: 32 },
    5: { 11: 160, 12: 80, 13: 64, 21: 80, 22: 40, 23: 40 },
    6: { 11: 192, 12: 96, 13: 80, 21: 96, 22: 48, 23: 48 },
    7: { 11: 224, 12: 112, 13: 96, 21: 112, 22: 56, 23: 56 },
    8: { 11: 256, 12: 128, 13: 112, 21: 128, 22: 64, 23: 64 },
    9: { 11: 288, 12: 160, 13: 128, 21: 144, 22: 80, 23: 80 },
    10: { 11: 320, 12: 192, 13: 160, 21: 160, 22: 96, 23: 96 },
    11: { 11: 352, 12: 224, 13: 192, 21: 176, 22: 112, 23: 112 },
    12: { 11: 384, 12: 256, 13: 224, 21: 192, 22: 128, 23: 128 },
    13: { 11: 416, 12: 320, 13: 256, 21: 224, 22: 144, 23: 144 },
    14: { 11: 448, 12: 384, 13: 320, 21: 256, 22: 160, 23: 160 },
  };

  static sampling_rate_freq_index = {
    1: { 0: 44100, 1: 48000, 2: 32000 },
    2: { 0: 22050, 1: 24000, 2: 16000 },
    2.5: { 0: 11025, 1: 12000, 2: 8000 },
  };

  static samplesInFrameTable = [
    [0, 384, 1152, 1152],
    [0, 384, 1152, 576],
  ];

  constructor(buf, off) {
    this.versionIndex = getBitAllignedNumber(buf, off + 1, 3, 2);
    this.layer = MpegFrameHeader.LayerDescription[getBitAllignedNumber(buf, off + 1, 5, 2)];

    if (this.versionIndex > 1 && this.layer === 0) {
      this.parseAdtsHeader(buf, off);
    } else {
      this.parseMpegHeader(buf, off);
    }

    this.isProtectedByCRC = !isBitSet(buf, off + 1, 7);
  }

  calcDuration(numFrames) {
    return this.samplingRate == null ? null : (numFrames * this.calcSamplesPerFrame()) / this.samplingRate;
  }

  calcSamplesPerFrame() {
    return MpegFrameHeader.samplesInFrameTable[this.version === 1 ? 0 : 1][this.layer];
  }

  calculateSideInfoLength() {
    if (this.layer !== 3) return 2;
    if (this.channelModeIndex === 3) {
      if (this.version === 1) {
        return 17;
      }
      if (this.version === 2 || this.version === 2.5) {
        return 9;
      }
    } else {
      if (this.version === 1) {
        return 32;
      }
      if (this.version === 2 || this.version === 2.5) {
        return 17;
      }
    }
    return null;
  }

  calcSlotSize() {
    return [null, 4, 1, 1][this.layer];
  }

  parseMpegHeader(buf, off) {
    this.container = "MPEG";
    this.bitrateIndex = getBitAllignedNumber(buf, off + 2, 0, 4);
    this.sampRateFreqIndex = getBitAllignedNumber(buf, off + 2, 4, 2);
    this.padding = isBitSet(buf, off + 2, 6);
    this.privateBit = isBitSet(buf, off + 2, 7);
    this.channelModeIndex = getBitAllignedNumber(buf, off + 3, 0, 2);
    this.modeExtension = getBitAllignedNumber(buf, off + 3, 2, 2);
    this.isCopyrighted = isBitSet(buf, off + 3, 4);
    this.isOriginalMedia = isBitSet(buf, off + 3, 5);
    this.emphasis = getBitAllignedNumber(buf, off + 3, 7, 2);

    this.version = MpegFrameHeader.VersionID[this.versionIndex];
    this.channelMode = MpegFrameHeader.ChannelMode[this.channelModeIndex];

    this.codec = `MPEG ${this.version} Layer ${this.layer}`;

    const bitrateInKbps = this.calcBitrate();
    if (!bitrateInKbps) {
      throw new Error("Cannot determine bit-rate");
    }
    this.bitrate = bitrateInKbps * 1000;

    this.samplingRate = this.calcSamplingRate();
    if (this.samplingRate == null) {
      throw new Error("Cannot determine sampling-rate");
    }
  }

  parseAdtsHeader(buf, off) {
    this.version = this.versionIndex === 2 ? 4 : 2;
    this.container = `ADTS/MPEG-${this.version}`;
    const profileIndex = getBitAllignedNumber(buf, off + 2, 0, 2);
    this.codec = "AAC";
    this.codecProfile = MPEG4.AudioObjectTypes[profileIndex];

    const samplingFrequencyIndex = getBitAllignedNumber(buf, off + 2, 2, 4);
    this.samplingRate = MPEG4.SamplingFrequencies[samplingFrequencyIndex];

    const channelIndex = getBitAllignedNumber(buf, off + 2, 7, 3);
    this.mp4ChannelConfig = MPEG4_ChannelConfigurations[channelIndex];

    this.frameLength = getBitAllignedNumber(buf, off + 3, 6, 2) << 11;
  }

  calcBitrate() {
    if (this.bitrateIndex === 0x00 || this.bitrateIndex === 0x0f) {
      return null;
    }
    if (this.version && this.bitrateIndex) {
      const codecIndex = 10 * Math.floor(this.version) + this.layer;
      return MpegFrameHeader.bitrate_index[this.bitrateIndex][codecIndex];
    }
    return null;
  }

  calcSamplingRate() {
    if (this.sampRateFreqIndex === 0x03 || this.version === null || this.sampRateFreqIndex == null)
      return null;
    return MpegFrameHeader.sampling_rate_freq_index[this.version][this.sampRateFreqIndex];
  }
}
