import { cpSync, existsSync } from "node:fs";

const assetDirs = [
  ["src/views", "dist/src/views"],
  ["src/public", "dist/src/public"]
];

for (const [source, destination] of assetDirs) {
  if (existsSync(source)) {
    cpSync(source, destination, { recursive: true });
  }
}
