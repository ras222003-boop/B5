/** Validation-only pixel diagnostic, never changes an already evaluated model. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const root = resolve(process.argv[2]),
  origin = process.argv[3] ?? "http://127.0.0.1:4350";
const manifest = JSON.parse(
  await readFile(resolve(root, "manifest.json"), "utf8")
);
const row = manifest.samples.find(r => r.split === "validation");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", r =>
    r
      .request()
      .url()
      .startsWith(origin + "/")
      ? r.continue()
      : r.abort()
  );
  const page = await context.newPage();
  await page.goto(origin + "/navigation/vision");
  const rgba = await page.evaluate(
    async base64 => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const canvas = new OffscreenCanvas(416, 416),
        ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgb(114,114,114)";
      ctx.fillRect(0, 0, 416, 416);
      const ratio = Math.min(
        416 / image.naturalWidth,
        416 / image.naturalHeight
      );
      ctx.drawImage(
        image,
        0,
        0,
        Math.floor(image.naturalWidth * ratio),
        Math.floor(image.naturalHeight * ratio)
      );
      return Array.from(ctx.getImageData(0, 0, 416, 416).data);
    },
    (await readFile(resolve(root, row.path))).toString("base64")
  );
  await mkdir(resolve(root, "preprocess"), { recursive: true });
  await writeFile(
    resolve(root, "preprocess/browser-rgba.bin"),
    Buffer.from(rgba),
    { flag: "wx" }
  );
  console.log(
    JSON.stringify({
      validationImageId: row.id,
      bytes: rgba.length,
      usesProtectedFinal: false,
    })
  );
} finally {
  await browser.close();
}
