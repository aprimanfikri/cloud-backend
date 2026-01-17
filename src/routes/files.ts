import { Hono } from "hono";
import logger from "@/utils/logger";
import withPrisma from "@/lib/prisma";
import { ContextWithPrisma } from "@/types";
import DiscordService from "@/services/discord";
import { StorageService } from "@/services/storage";

export const filesRoute = new Hono<ContextWithPrisma>();

filesRoute.get("/", withPrisma, async (c) => {
  try {
    const folderId = c.req.query("folderId");
    const prisma = c.get("prisma");
    const storage = new StorageService(prisma);
    const list = await storage.list(folderId);
    return c.json(list);
  } catch (error) {
    logger.error(
      `[${c.get("id")}] [GET FILES] Error:`,
      error instanceof Error ? error.message : String(error),
    );
    return c.json({ error: "Internal server error" }, 500);
  }
});

filesRoute.get("/:filename", withPrisma, async (c) => {
  try {
    const filename = c.req.param("filename");
    if (!filename) {
      return c.json({ error: "filename is required" }, 400);
    }
    const prisma = c.get("prisma");
    const storage = new StorageService(prisma);
    const file = await storage.get(filename);
    if (!file) {
      return c.json({ error: "File not found" }, 404);
    }
    return c.json(file);
  } catch (error) {
    return c.json({ error: "Internal server error" }, 500);
  }
});

filesRoute.delete("/folder", withPrisma, async (c) => {
  try {
    const body = await c.req.json<{ folderPath?: string }>();
    const folderPath = body.folderPath;
    if (!folderPath) {
      return c.json({ error: "folderPath is required" }, 400);
    }
    if (folderPath === "/" || folderPath === "root") {
      return c.json({ error: "Invalid folderPath" }, 400);
    }
    logger.log(
      `[${c.get("id")}] [DELETE FOLDER] Starting bulk deletion for: ${folderPath}`,
    );

    const prisma = c.get("prisma");
    const storage = new StorageService(prisma);
    const pathPrefix = folderPath.endsWith("/") ? folderPath : `${folderPath}/`;
    const filesToDelete = await prisma.file.findMany({
      where: {
        OR: [
          { folder_id: folderPath },
          { folder_id: { startsWith: pathPrefix } },
        ],
      },
      select: { id: true },
    });

    if (!filesToDelete || filesToDelete.length === 0) {
      return c.json({ status: "done", count: 0 });
    }

    const fileIds = filesToDelete.map((f) => f.id);
    const chunksToDelete = await prisma.chunk.findMany({
      where: { file_id: { in: fileIds } },
      select: { message_id: true, url: true },
    });

    if (chunksToDelete && chunksToDelete.length > 0) {
      const messageIds = chunksToDelete
        .map((chunk) => {
          if (chunk.message_id) return chunk.message_id;
          if (chunk.url) {
            const match = chunk.url.match(/attachments\/\d+\/(\d+)\//);
            return match ? match[1] : null;
          }
          return null;
        })
        .filter((id): id is string => Boolean(id));

      if (messageIds.length > 0) {
        await DiscordService.instance.bulkDeleteMessages(messageIds);
      }
    }

    const deleteResult = await prisma.file.deleteMany({
      where: { id: { in: fileIds } },
    });

    return c.json({ status: "done", count: deleteResult.count });
  } catch (error) {
    return c.json({ error: "Internal server error" }, 500);
  }
});

filesRoute.delete("/:filename", withPrisma, async (c) => {
  try {
    const filename = c.req.param("filename");
    if (!filename) {
      return c.json({ error: "filename is required" }, 400);
    }

    const prisma = c.get("prisma");
    const storage = new StorageService(prisma);
    const metadata = await storage.get(filename);
    if (!metadata) {
      return c.json({ error: "Not found" }, 404);
    }

    if (metadata.chunks && metadata.chunks.length > 0) {
      const messageIds = metadata.chunks
        .map((c) => c.messageId)
        .filter((id): id is string => Boolean(id));
      if (messageIds.length > 0) {
        await DiscordService.instance.bulkDeleteMessages(messageIds);
      }
    }

    await storage.delete(filename);
    return c.json({ status: "deleted" });
  } catch (err) {
    if (err instanceof Error) {
      logger.error(`[${c.get("id")}] Delete File failure:`, err.message);
    } else {
      logger.error(`[${c.get("id")}] Delete File failure:`, String(err));
    }
    return c.json({ error: "Failed" }, 500);
  }
});
