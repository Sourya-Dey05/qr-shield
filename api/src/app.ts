import express from "express";
import { validateHandler } from "./handlers/validate";

const app = express();

app.use(express.json());

// Health check — useful for deployment platforms and CI smoke tests.
app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/api/validate", validateHandler);

// Catch-all for unknown routes.
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } });
});

// Global error handler — prevents stack traces from reaching API consumers.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Log server-side; the client only sees a safe message.
  // eslint-disable-next-line no-console
  console.error("[unhandled error]", err.message);
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  });
});

export default app;
