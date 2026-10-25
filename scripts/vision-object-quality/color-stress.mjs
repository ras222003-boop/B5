/** Controlled perturbations of licensed real photos, with ORACLE reference masks for diagnostics only. */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const origin = process.argv[2] ?? "http://127.0.0.1:4350",
  root = resolve(
    process.argv[3] ?? "../.vision-test-fixtures/object-quality-002"
  ),
  manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
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
  for (const [imageId, objectId] of [
    ["85157", "674443"],
    ["132796", "580884"],
  ]) {
    const row = manifest.samples.find(r => r.id === imageId),
      object = row.objects.find(o => o.id === objectId),
      image = await readFile(resolve(root, row.path)),
      mask = await readFile(resolve(root, object.mask));
    const result = await page.evaluate(
      async ({ image, mask, object }) => {
        const { sampleColorFrame, analyzeObjectColor } = await import(
          "/src/lib/vision/objectColors.ts"
        );
        const im = new Image(),
          mi = new Image();
        im.src = "data:image/png;base64," + image;
        mi.src = "data:image/png;base64," + mask;
        await Promise.all([im.decode(), mi.decode()]);
        const c = document.createElement("canvas");
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        c.getContext("2d").drawImage(im, 0, 0);
        const original = sampleColorFrame(c, 1, "stress");
        c.width = original.width;
        c.height = original.height;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(mi, 0, 0, c.width, c.height);
        const maskData = ctx.getImageData(0, 0, c.width, c.height).data,
          foreground = Uint8Array.from(
            { length: c.width * c.height },
            (_, i) => (maskData[i * 4] > 128 ? 1 : 0)
          );
        const d = {
            id: object.id,
            cocoClass: object.class,
            type: "UNKNOWN_OBSTACLE",
            confidence: 1,
            boundingBox: {
              x: object.box[0],
              y: object.box[1],
              width: object.box[2],
              height: object.box[3],
            },
            timestamp: 1,
            source: "OBJECT_DETECTOR",
          },
          inside = [];
        for (let i = 0; i < foreground.length; i++)
          if (foreground[i])
            inside.push([
              original.data[i * 4],
              original.data[i * 4 + 1],
              original.data[i * 4 + 2],
            ]);
        const mean = [0, 1, 2].map(k =>
            inside.reduce((n, p) => n + p[k] / inside.length, 0)
          ),
          cases = [];
        for (const variant of [
          "baseline",
          "same_coloured_background",
          "darkness",
          "glare",
        ]) {
          const pixels = {
            ...original,
            data: new Uint8ClampedArray(original.data),
          };
          for (let i = 0; i < foreground.length; i++)
            for (let k = 0; k < 3; k++) {
              if (variant === "darkness") pixels.data[i * 4 + k] *= 0.06;
              if (variant === "same_coloured_background" && !foreground[i])
                pixels.data[i * 4 + k] = mean[k];
              if (variant === "glare" && foreground[i] && i % 4 !== 0)
                pixels.data[i * 4 + k] = 255;
            }
          cases.push({
            variant,
            box: analyzeObjectColor(pixels, d),
            oracleMask: analyzeObjectColor(pixels, d, [], {
              source: "INSTANCE_SEGMENTATION",
              alignmentVerified: true,
              objectId: d.id,
              frameId: "stress",
              width: pixels.width,
              height: pixels.height,
              data: foreground,
            }),
          });
        }
        return cases;
      },
      { image: image.toString("base64"), mask: mask.toString("base64"), object }
    );
    results.push({ imageId, objectId, cases: result });
  }
  const mandatory = results.flatMap(r =>
    r.cases.filter(c => ["darkness", "glare"].includes(c.variant))
  );
  if (mandatory.some(c => c.box.name || c.oracleMask.name))
    throw new Error("Colour failed to abstain under controlled darkness/glare");
  await writeFile(
    resolve(root, "color-stress.json"),
    JSON.stringify(
      {
        scope:
          "controlled_perturbations_of_real_photos_not_natural_capture_evaluation",
        referenceMasksUsedForOracleProbe: true,
        notPredictedMasks: true,
        humanAccuracy: null,
        results,
        darknessGlareAbstentionsPassed: true,
      },
      null,
      2
    ),
    { flag: "wx" }
  );
  console.log(
    JSON.stringify({
      photos: results.length,
      cases: results.reduce((n, r) => n + r.cases.length, 0),
      darknessGlareAbstentionsPassed: true,
    })
  );
} finally {
  await browser.close();
}
