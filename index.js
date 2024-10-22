import { fromFile } from "strtok3";
import { MpegParser } from "./src/mpeg-parser.js";
import { Metadata } from "./src/metadata.js";

const filePath = "sample.mp3";
const tokenizer = await fromFile(filePath);
const opts = { skipPostHeaders: true };
const metadata = new Metadata(opts);
const parser = new MpegParser(metadata, tokenizer, opts);
await parser.parse();

console.log("metadata", metadata);
