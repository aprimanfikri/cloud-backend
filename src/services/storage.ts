import { PrismaClient } from "@/generated/prisma/client";
import type { SaveFileWithChunksParams } from "@/types";
import logger from "@/utils/logger";

export class StorageService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(folderId: string | null = null) {
    const where =
      folderId === "root" || folderId === "/"
        ? { folder_id: null }
        : folderId && folderId !== "all"
          ? { folder_id: folderId }
          : {};
    const files = await this.prisma.file.findMany({
      where,
      orderBy: { date: "desc" },
    });
    return files.map((f) => ({
      ...f,
      size: Number(f.size),
      folderId: f.folder_id,
      folder: f.folder_id ?? "/",
    }));
  }

  async get(filename: string) {
    const file = await this.prisma.file.findFirst({
      where: { name: filename },
      include: {
        chunks: {
          orderBy: { chunk_index: "asc" },
        },
      },
    });
    if (!file) return null;
    return {
      ...file,
      size: Number(file.size),
      folderId: file.folder_id,
      folder: file.folder_id ?? "/",
      chunks: file.chunks.map((c) => ({
        index: c.chunk_index,
        messageId: c.message_id,
        url: c.url,
        iv: c.iv,
        size: Number(c.size),
      })),
    };
  }

  async save(metadata: SaveFileWithChunksParams, requestId = "internal") {
    const path =
      metadata.folderId === "/" || metadata.folderId === "root"
        ? null
        : metadata.folderId;
    await this.prisma.$transaction(async (tx) => {
      await tx.file.upsert({
        where: { id: metadata.fileId },
        update: {
          name: metadata.name,
          size: metadata.size,
          type: metadata.type,
          folder_id: path,
          iv: metadata.iv,
          date: metadata.date ?? new Date(),
        },
        create: {
          id: metadata.fileId,
          name: metadata.name,
          size: metadata.size,
          type: metadata.type,
          folder_id: path,
          iv: metadata.iv,
          date: metadata.date ?? new Date(),
        },
      });
      await tx.chunk.deleteMany({
        where: { file_id: metadata.fileId },
      });
      if (metadata.chunks.length > 0) {
        await tx.chunk.createMany({
          data: metadata.chunks.map((c) => ({
            file_id: metadata.fileId,
            chunk_index: c.index,
            message_id: c.messageId,
            url: c.url,
            iv: c.iv,
            size: c.size,
          })),
        });
      }
    });
    logger.log(`[${requestId}] [Storage] Save complete for: ${metadata.name}`);
  }

  async delete(filename: string) {
    const file = await this.prisma.file.findFirst({
      where: { name: filename },
      include: {
        chunks: {
          orderBy: { chunk_index: "asc" },
        },
      },
    });
    if (!file) return false;
    await this.prisma.file.delete({
      where: { id: file.id },
    });
    return true;
  }
}
