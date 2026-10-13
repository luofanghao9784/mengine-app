import { existsSync } from "node:fs";
import { buildServer } from "./server.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const { app } = await buildServer({
  dbPath: process.env.DATABASE_PATH || ".runtime/mengine.db",
  storage: process.env.DOCUMENT_STORAGE_PATH || ".runtime/documents",
  demo: process.env.DEMO_MODE === "true",
  production: process.env.NODE_ENV === "production",
  origin: process.env.APP_ORIGIN,
  sceneOrigin: process.env.SCENE_FOUNDATION_ORIGIN,
  model: {
    enabled: process.env.DASHSCOPE_ENABLED !== "false",
    apiKey: process.env.DASHSCOPE_API_KEY || "",
    baseUrl:
      process.env.DASHSCOPE_BASE_URL ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: process.env.DASHSCOPE_MODEL || "qwen-plus",
  },
});
await app.listen({
  host: "127.0.0.1",
  port: Number(process.env.API_PORT || 4400),
});
console.log(
  `Mengine API ready on http://127.0.0.1:${process.env.API_PORT || 4400}`,
);
for (const event of ["SIGINT", "SIGTERM"])
  process.on(event, () => void app.close().then(() => process.exit(0)));
