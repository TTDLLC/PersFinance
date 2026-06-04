import { cpSync, existsSync, rmSync } from "node:fs";

const assetDirs = [
  ["src/views", "dist/src/views"],
  ["src/public", "dist/src/public"]
];

for (const [source, destination] of assetDirs) {
  if (existsSync(source)) {
    rmSync(destination, { recursive: true, force: true });
    cpSync(source, destination, { recursive: true });
  }
}
