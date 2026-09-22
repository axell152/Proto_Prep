import { copyFileSync, mkdirSync, existsSync } from "node:fs";

const src = "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs";

if (existsSync(src)) {
  mkdirSync("public", { recursive: true });
  copyFileSync(src, "public/pdf.worker.min.mjs");
  console.log("PDF.js worker copié dans public/");
} else {
  console.warn("PDF.js worker introuvable :", src);
}
