import { Hono } from "hono";
import crypto from "crypto";
import logger from "@/utils/logger";
import withPrisma from "@/lib/prisma";
import { ContextWithPrisma } from "@/types";
import { StorageService } from "@/services/storage";
import { config } from "@/config/env";

const ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(String(config.ENCRYPTION_KEY))
  .digest();

const mimeTypes: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/webm",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  zip: "application/zip",
  rar: "application/x-rar-compressed",
  "7z": "application/x-7z-compressed",
  exe: "application/octet-stream",
};

export const downloadRoute = new Hono<ContextWithPrisma>();

downloadRoute.get("/:filename", withPrisma, async (c) => {
  try {
    const filename = c.req.param("filename");
    if (!filename) {
      return c.text("File not found", 404);
    }

    const prisma = c.get("prisma");
    const storage = new StorageService(prisma);
    const metadata = await storage.get(filename);
    if (!metadata) {
      return c.text("File not found", 404);
    }

    const fileSize = Number(metadata.size);
    const disposition =
      c.req.query("download") === "true" ? "attachment" : "inline";
    const ext = metadata.name.split(".").pop()?.toLowerCase() ?? "";
    const mimeType = mimeTypes[ext] || "application/octet-stream";
    const fileIv = metadata.iv ? Buffer.from(metadata.iv, "hex") : null;

    const baseHeaders = new Headers();
    baseHeaders.set(
      "Content-Disposition",
      `${disposition}; filename="${metadata.name}"`,
    );
    baseHeaders.set("Content-Type", mimeType);
    baseHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
    baseHeaders.set("Accept-Ranges", "bytes");

    const isExpired = (url: string | null | undefined) => {
      if (!url) return false;
      try {
        const urlObj = new URL(url);
        const ex = urlObj.searchParams.get("ex");
        if (!ex) return false;
        const expiry = parseInt(ex, 16);
        const now = Math.floor(Date.now() / 1000);
        return now > expiry - 300;
      } catch {
        return false;
      }
    };

    const fetchAndDecryptChunk = async (
      chunkUrl: string,
      iv: Buffer | null,
    ): Promise<Uint8Array> => {
      const response = await fetch(chunkUrl);
      if (!response.ok || !response.body) {
        throw new Error(
          `Failed to fetch chunk: ${response.status} ${response.statusText}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      let data = Buffer.from(arrayBuffer);
      const currentIv = iv;
      if (currentIv) {
        const decipher = crypto.createDecipheriv(
          "aes-256-ctr",
          ENCRYPTION_KEY,
          currentIv,
        );
        const decrypted = Buffer.concat([
          decipher.update(data),
          decipher.final(),
        ]);
        data = decrypted;
      }
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    };

    const resolveChunkUrl = async (chunk: {
      url: string | null;
      messageId?: string | null;
      iv: string | null;
      size: bigint;
      index: number;
    }): Promise<string | null> => {
      let chunkUrl = chunk.url;
      if (
        isExpired(chunkUrl) &&
        chunk.messageId &&
        config.DISCORD_BOT_TOKEN &&
        config.DISCORD_CHANNEL_ID
      ) {
        try {
          const res = await fetch(
            `https://discord.com/api/v10/channels/${config.DISCORD_CHANNEL_ID}/messages/${chunk.messageId}`,
            {
              headers: {
                Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
              },
            },
          );
          if (res.ok) {
            const data = (await res.json()) as {
              attachments?: Array<{ url?: string }>;
            };
            if (data.attachments && data.attachments[0]?.url) {
              chunkUrl = data.attachments[0].url ?? null;
              logger.log(
                `[${c.get("id")}] [DOWNLOAD] Refreshed URL for chunk ${chunk.index}`,
              );
            }
          }
        } catch (err) {
          if (err instanceof Error) {
            logger.warn(
              `[${c.get("id")}] Failed to refresh URL: ${err.message}`,
            );
          } else {
            logger.warn(
              `[${c.get("id")}] Failed to refresh URL: ${String(err)}`,
            );
          }
        }
      }
      return chunkUrl ?? null;
    };

    const body = new Uint8Array(fileSize);
    let writeOffset = 0;
    for (const chunk of metadata.chunks) {
      if (!chunk.url) continue;
      const chunkUrl = await resolveChunkUrl({
        ...chunk,
        size: BigInt(chunk.size),
      });
      if (!chunkUrl) continue;
      const iv =
        chunk.iv && chunk.iv.length > 0 ? Buffer.from(chunk.iv, "hex") : fileIv;
      const decrypted = await fetchAndDecryptChunk(chunkUrl, iv);
      body.set(decrypted, writeOffset);
      writeOffset += decrypted.length;
    }

    const headers = new Headers(baseHeaders);
    headers.set("Content-Length", String(fileSize));

    return new Response(body, {
      status: 200,
      headers,
    });
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`[${c.get("id")}] Download Error: ${err.message}`);
    } else {
      logger.error(`[${c.get("id")}] Download Error: ${String(err)}`);
    }
    return c.text("Failed", 500);
  }
});
