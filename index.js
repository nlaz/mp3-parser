import { fromFile } from "strtok3";
import { MpegParser } from "./src/MpegParser.js";
import { MetadataCollector } from "./src/MetadataCollector.js";

const filePath = "sample.mp3";
const fileTokenizer = await fromFile(filePath);
const opts = {};
console.log("fileTokenizer", fileTokenizer.peekToken());
const metadata = new MetadataCollector(opts);
const parser = new MpegParser(metadata, fileTokenizer, opts);
await parser.parse();

console.log("metadata", metadata);
