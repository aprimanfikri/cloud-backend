import app from "@/app";
import { config } from "@/config/env";

Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
  idleTimeout: 255,
});

console.log(`Server running at port: ${config.PORT}`);
