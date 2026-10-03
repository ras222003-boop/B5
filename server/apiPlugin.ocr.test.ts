import { createServer } from "node:http";
import express from "express";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ registerOcrRoute: vi.fn() }));
vi.mock("./ocr", () => ({ registerOcrRoute: mocked.registerOcrRoute }));

import { vitePluginApiProxy } from "./apiPlugin";

describe("Vite development OCR route", () => {
  afterEach(() => mocked.registerOcrRoute.mockReset());

  it("uses the production route and JSON parser rather than a separate OCR schema", async () => {
    mocked.registerOcrRoute.mockImplementation((app: express.Express) => {
      app.post("/api/ocr", (req, res) => res.json({
        image: req.body.imageBase64,
        quality: { status: "partial", issues: [] },
        detectedLanguages: ["ar", "en"],
      }));
    });

    const app = express();
    const plugin = vitePluginApiProxy();
    const configure = plugin.configureServer;
    if (typeof configure !== "function") throw new Error("Vite plugin has no server hook");
    configure({ middlewares: { use: app.use.bind(app) } } as unknown as ViteDevServer);

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No local test port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: "sample-image" }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        image: "sample-image",
        quality: { status: "partial", issues: [] },
        detectedLanguages: ["ar", "en"],
      });
      expect(mocked.registerOcrRoute).toHaveBeenCalledOnce();
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it("escapes OCR text and typed answers in the development print preview", async () => {
    const app = express();
    const configure = vitePluginApiProxy().configureServer;
    if (typeof configure !== "function") throw new Error("Vite plugin has no server hook");
    configure({ middlewares: { use: app.use.bind(app) } } as unknown as ViteDevServer);

    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No local test port");
      const attack = "<img src=x onerror=alert(1)>";
      const response = await fetch(`http://127.0.0.1:${address.port}/api/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examTitle: attack,
          questions: [{ id: 1, text: attack, type: "multiple", options: [attack] }],
          answers: { 1: attack },
          grading: {
            totalScore: 50,
            overallFeedback: attack,
            results: [{ questionId: 1, isCorrect: 'incorrect" onclick="alert(1)', correctAnswer: attack, feedback: attack }],
          },
          language: "en",
        }),
      });
      expect(response.status).toBe(200);
      const data = await response.json() as { html: string };
      expect(data.html).not.toContain(attack);
      expect(data.html).not.toContain('onclick="alert(1)');
      expect(data.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
