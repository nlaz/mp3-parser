import { MpegParser } from "./src/parser.js";

const filePath = "sample.mp3";
const parser = new MpegParser(filePath);
const metadata = await parser.parse();

console.log("metadata", metadata);
