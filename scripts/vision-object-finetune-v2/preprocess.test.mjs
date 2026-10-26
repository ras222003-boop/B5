/** Unit/contract fixtures only; these are not model training or evaluation photos. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { chromium } from "@playwright/test";
import {
  developmentRows,
  exportDevelopment,
  canvasPixels,
} from "./preprocess.mjs";
const hash = b => createHash("sha256").update(b).digest("hex");
const sample = (id, split, groupId = id) => ({
  id,
  split,
  source: "unit-fixture",
  groupId,
});
test("protected final cannot be requested and scene groups cannot cross splits", () => {
  assert.throws(
    () => developmentRows({ samples: [sample("a", "test")] }, ["test"]),
    /protected/
  );
  assert.throws(
    () =>
      developmentRows({
        samples: [sample("a", "train", "same"), sample("b", "test", "same")],
      }),
    /crosses splits/
  );
  assert.throws(
    () => developmentRows({ samples: [sample("../bad", "train")] }),
    /Unsafe/
  );
  assert.deepEqual(
    developmentRows({
      samples: [
        sample("a", "train"),
        sample("b", "validation"),
        sample("c", "test"),
      ],
    }).map(r => r.id),
    ["a", "b"]
  );
});

test("actual Canvas RGBA matches the deployed detector input exactly; export resumes and protects unread final pixels", async () => {
  const base = resolve(".vision-ai");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, "preprocess-unit-"));
  assert.equal(dirname(root), base);
  const width = 617,
    height = 413,
    raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    raw[3 * i] = (i * 17) % 256;
    raw[3 * i + 1] = (i * 31) % 256;
    raw[3 * i + 2] = (i * 7) % 256;
  }
  const png = await sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    const origin = process.env.BASIRA_TEST_ORIGIN ?? "http://127.0.0.1:4350";
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
    const rendered = await page.evaluate(canvasPixels, {
      base64: png.toString("base64"),
      width,
      height,
    });
    const rgba = Buffer.from(rendered.base64, "base64");
    assert.equal(rgba.length, 416 * 416 * 4);
    const result = await page.evaluate(
      async ({ base64, width, height, rgba }) => {
        const { YoloXProvider } = await import(
          "/src/lib/vision/qualityProviders.ts"
        );
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const frame = new OffscreenCanvas(width, height);
        frame.getContext("2d").drawImage(image, 0, 0);
        const htmlFrame = document.createElement("canvas");
        htmlFrame.width = width;
        htmlFrame.height = height;
        htmlFrame.getContext("2d").drawImage(image, 0, 0);
        const bitmap = await createImageBitmap(htmlFrame),
          workerFrame = new OffscreenCanvas(width, height);
        workerFrame.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close();
        let tensor = null;
        // Deliberate session spy: no weights/model inference is claimed by this contract test.
        const provider = new YoloXProvider({
          run: async input => {
            tensor = input.images.data;
            return {
              output: {
                type: "float32",
                dims: [1, 3549, 85],
                data: new Float32Array(3549 * 85),
              },
            };
          },
        });
        const results = [];
        for (const [kind, input] of [
          ["offscreen", frame],
          ["html-photo-canvas", htmlFrame],
          ["image-bitmap-worker-transfer", workerFrame],
        ]) {
          await provider.detect(input, 1);
          let differing = 0;
          for (let i = 0; i < 416 * 416; i++) {
            differing += Number(tensor[i] !== rgba[i * 4 + 2]);
            differing += Number(tensor[416 * 416 + i] !== rgba[i * 4 + 1]);
            differing += Number(tensor[2 * 416 * 416 + i] !== rgba[i * 4]);
          }
          results.push({ kind, differing, tensorLength: tensor.length });
        }
        return results;
      },
      { base64: png.toString("base64"), width, height, rgba: Array.from(rgba) }
    );
    assert.equal(result.length, 3);
    for (const item of result) {
      assert.equal(item.differing, 0, item.kind);
      assert.equal(item.tensorLength, 3 * 416 * 416);
    }
    await writeFile(resolve(root, "fixture.png"), png);
    const manifest = {
      samples: [
        {
          ...sample("train", "train"),
          path: "fixture.png",
          sha256: hash(png),
          width,
          height,
        },
        {
          ...sample("validation", "validation"),
          path: "fixture.png",
          sha256: hash(png),
          width,
          height,
        },
        {
          ...sample("protected", "test"),
          path: "MUST_NOT_BE_OPENED.png",
          sha256: "a".repeat(64),
          width,
          height,
        },
      ],
    };
    const bytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(resolve(root, "manifest.json"), bytes);
    await writeFile(
      resolve(root, "cohort-lock.json"),
      JSON.stringify({ manifestSha256: hash(bytes) })
    );
    const index = await exportDevelopment(root, origin);
    assert.equal(index.protectedTestImagesProcessed, 0);
    assert.equal(index.modelInferenceExecuted, false);
    assert.equal(index.entries.length, 2);
    assert.deepEqual(
      await readFile(resolve(root, index.entries[0].path)),
      rgba
    );
    const resumed = await exportDevelopment(root, origin);
    assert.deepEqual(resumed, index);
    await writeFile(resolve(root, index.entries[0].path), "modified");
    await assert.rejects(exportDevelopment(root, origin), /pixels changed/);
    if (process.env.BASIRA_PREPROCESS_TEST_EVIDENCE) {
      await writeFile(
        resolve(process.env.BASIRA_PREPROCESS_TEST_EVIDENCE),
        JSON.stringify(
          {
            scope: "synthetic_unit_pixel_contract_not_model_accuracy",
            usedSyntheticUnitFixture: true,
            realModelInferenceExecuted: false,
            actualChromeSourcePathComparisons: result,
            helperSha256: hash(
              await readFile(new URL("./preprocess.mjs", import.meta.url))
            ),
            deployedDetectorSha256: hash(
              await readFile(
                resolve("client/src/lib/vision/qualityProviders.ts")
              )
            ),
            protectedTestPixelReadRejected: true,
            sceneSplitLeakRejected: true,
            immutableResumeVerified: true,
            corruptedPixelsRejected: true,
            note: "Exact on the tested local Chrome. This is not iPhone/Safari pixel or device qualification.",
          },
          null,
          2
        ),
        { flag: "wx" }
      );
    }
  } finally {
    await browser.close();
    assert.equal(dirname(root), base);
    await rm(root, { recursive: true, force: true });
  }
});
