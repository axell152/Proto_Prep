// Copie le worker pdfjs dans /public
// après npm install.

import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const src = "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";

if (existsSync(src)) {
  mkdirSync("public", { recursive: true });
  copyFileSync(src, "public/pdf.worker.min.mjs");
}
