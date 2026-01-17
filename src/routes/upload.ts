import { Hono } from "hono";
import crypto from "crypto";
import logger from "@/utils/logger";
import withPrisma from "@/lib/prisma";
import {
  ContextWithPrisma,
  FileChunkInput,
  SaveFileWithChunksParams,
} from "@/types";
import DiscordService from "@/services/discord";
import { StorageService } from "@/services/storage";
import { config } from "@/config/env";

const ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(String(config.ENCRYPTION_KEY))
  .digest();

export const uploadRoute = new Hono<ContextWithPrisma>();

uploadRoute.post("/chunk", async (c) => {
  try {
    const formData = await c.req.formData();
    let file: File | null = null;
    for (const [, value] of formData.entries()) {
      if (
        typeof value === "object" &&
        value !== null &&
        "arrayBuffer" in value
      ) {
        file = value as File;
        break;
      }
    }
    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }
    const originalName = file.name || "chunk";
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = new Uint8Array(arrayBuffer);
    logger.log(`[${c.get("id")}] [CHUNK] Start: ${originalName}`);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-ctr", ENCRYPTION_KEY, iv);
    const encryptedChunk = Buffer.concat([
      cipher.update(fileBuffer),
      cipher.final(),
    ]);
    const cleanName = originalName.replace(/[^a-zA-Z0-9_-]/g, "");
    const discordFilename = `${cleanName}_${Date.now()}.bin`;
    const { id, url } = await DiscordService.instance.uploadBuffer(
      encryptedChunk,
      discordFilename,
    );
    logger.log(`[${c.get("id")}] [CHUNK] Done: ${discordFilename}`);
    return c.json({
      messageId: id,
      url: url,
      iv: iv.toString("hex"),
      size: fileBuffer.length,
    });
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`[${c.get("id")}] Chunk Upload Error: ${error.message}`);
    } else {
      logger.error(`[${c.get("id")}] Chunk Upload Error: ${String(error)}`);
    }
    return c.json({ error: "Failed to upload chunk" }, 500);
  }
});

uploadRoute.post("/finalize", withPrisma, async (c) => {
  try {
    const body = await c.req.json<{
      filename?: string;
      chunks?: Array<{
        index?: number;
        messageId: string;
        url: string;
        iv?: string | null;
        size: number;
      }>;
      totalSize?: number;
      type?: string | null;
      folder?: string | null;
      folderId?: string | null;
    }>();
    const { filename, chunks, totalSize, type, folderId } = body;
    if (!filename || !chunks || !Array.isArray(chunks)) {
      return c.json({ error: "Invalid metadata" }, 400);
    }
    const prisma = c.get("prisma");
    const storage = new StorageService(prisma);
    const fileId = crypto.randomUUID();
    const mappedChunks: FileChunkInput[] = chunks.map((chunk, index) => ({
      index: chunk.index ?? index,
      messageId: chunk.messageId,
      url: chunk.url,
      iv: chunk.iv ?? null,
      size: BigInt(chunk.size),
    }));
    const metadata: SaveFileWithChunksParams = {
      fileId,
      name: filename,
      size: BigInt(totalSize ?? 0),
      type: type ?? null,
      folderId: folderId ?? null,
      iv: null,
      date: new Date(),
      chunks: mappedChunks,
    };
    await storage.save(metadata, c.get("id"));
    logger.log(
      `[${c.get("id")}] [FINALIZE] Saved ${filename} (${totalSize ?? 0} bytes)`,
    );
    return c.json({ success: true, filename });
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`[${c.get("id")}] Metadata Save Error: ${err.message}`);
    } else {
      logger.error(`[${c.get("id")}] Metadata Save Error: ${String(err)}`);
    }
    return c.json({ error: "Failed to save metadata" }, 500);
  }
});

uploadRoute.delete("/cancel", async (c) => {
  try {
    const body = await c.req.json<{ messageIds?: string[] }>();
    const { messageIds } = body;
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return c.json({ status: "nothing to clean" });
    }
    logger.log(
      `[${c.get("id")}] [UPLOAD CANCEL] Cleaning up ${messageIds.length} orphaned chunks...`,
    );
    await DiscordService.instance.bulkDeleteMessages(messageIds);
    return c.json({ status: "cleaned", count: messageIds.length });
  } catch (err) {
    if (err instanceof Error) {
      logger.error(
        `[${c.get("id")}] [UPLOAD CANCEL] Cleanup failed: ${err.message}`,
      );
    } else {
      logger.error(
        `[${c.get("id")}] [UPLOAD CANCEL] Cleanup failed: ${String(err)}`,
      );
    }
    return c.json({ error: "Cleanup partially failed" }, 500);
  }
});
