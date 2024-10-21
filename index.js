import { fromFile } from "strtok3";
import { MpegParser } from "./src/MpegParser.js";
import { MetadataCollector } from "./src/MetadataCollector.js";

const filePath = "sample.mp3";
const tokenizer = await fromFile(filePath);
const opts = {};
const metadata = new MetadataCollector(opts);
const parser = new MpegParser(metadata, tokenizer, opts);
await parser.parse();

console.log("metadata", metadata);
console.log("warning", metadata.quality.warnings[2]);
