import { fromFile } from "./src/tokenizer.js";
import { MpegParser } from "./src/parser.js";

const filePath = "sample.mp3";
const tokenizer = await fromFile(filePath);
const parser = new MpegParser(tokenizer);
const metadata = await parser.parse();

console.log("metadata", metadata);
