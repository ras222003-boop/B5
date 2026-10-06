import express, { type Express } from "express";
import { toNodeHandler } from "better-auth/node";
import { auth, providerReady } from "./auth";
import { registerSpeechRoutes } from "./speech";

/** Keep the raw Better Auth request ahead of every body parser in both servers. */
export function registerAccountAndSpeechRoutes(app: Express) {
  app.get("/api/auth/providers", (_req, res) => {
    res.set("Cache-Control", "no-store").json({ providers: providerReady, emailPassword: true });
  });
  app.all("/api/auth/*", toNodeHandler(auth));
  app.use("/api/speech", express.json({ limit: "32kb" }));
  registerSpeechRoutes(app);
}
