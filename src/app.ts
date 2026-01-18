import { Hono } from "hono";
import { cors } from "hono/cors";
import logger from "@/utils/logger";
import { logger as appLogger } from "hono/logger";
import { config } from "@/config/env";
import { ContextWithPrisma } from "@/types";
import { filesRoute } from "@/routes/files";
import { uploadRoute } from "@/routes/upload";
// import { rateLimiter } from "hono-rate-limiter";
import { downloadRoute } from "@/routes/download";
import { secureHeaders } from "hono/secure-headers";

const app = new Hono<ContextWithPrisma>();

app.use(appLogger());

app.use(async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set("id", requestId);
  await next();
});

app.use(
  secureHeaders({
    crossOriginResourcePolicy: "cross-origin",
  }),
);

app.use(
  cors({
    origin: config.ALLOWED_ORIGIN,
    allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

// const globalLimiter = rateLimiter({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   limit: 100,
//   keyGenerator: (c) => c.req.header("x-forwarded-for") ?? "",
// });

// const sensitiveLimiter = rateLimiter({
//   windowMs: 60 * 60 * 1000, // 1 hour
//   limit: 50,
//   keyGenerator: (c) => c.req.header("x-forwarded-for") ?? "",
// });

// app.use(globalLimiter);

// app.use("/upload/finalize", sensitiveLimiter);
// app.use("/upload/cancel", sensitiveLimiter);
app.route("/upload", uploadRoute);

// app.use("/files/folder", sensitiveLimiter);
app.route("/files", filesRoute);
app.route("/download", downloadRoute);

app.use("*", async (c) => {
  return c.json({ error: "Not found" }, 404);
});

app.onError((err, c) => {
  logger.error(err.stack);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
