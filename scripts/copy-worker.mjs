// scripts/copy-worker.mjs

import {
  copyFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";

const src =
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";

const dest =
  "public/pdf.worker.min.mjs";

if (existsSync(src)) {
  mkdirSync("public", { recursive: true });

  copyFileSync(src, dest);

  console.log(
    "PDF.js worker copié dans public/pdf.worker.min.mjs"
  );
} else {
  console.warn(
    "Worker PDF.js introuvable :",
    src
  );
}
