import { PrismaClient } from "@/generated/prisma/client";

export type ContextWithPrisma = {
  Variables: {
    id: string;
    prisma: PrismaClient;
  };
};

export interface UploadResult {
  id: string;
  url: string;
}

export interface DiscordMessage {
  id: string;
  attachments: Array<{
    url: string;
    id: string;
    filename: string;
    size: number;
  }>;
}

export interface RateLimitData {
  retry_after: number;
  global: boolean;
  message?: string;
}

export interface FileChunkInput {
  index: number;
  messageId: string;
  url: string;
  iv: string | null;
  size: bigint;
}

export interface SaveFileWithChunksParams {
  fileId: string;
  name: string;
  size: bigint;
  type: string | null;
  folderId: string | null;
  iv: string | null;
  date: Date | null;
  chunks: FileChunkInput[];
}
