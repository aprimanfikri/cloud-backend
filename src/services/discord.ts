import logger from "@/utils/logger";
import { config } from "@/config/env";
import { DiscordMessage, RateLimitData, UploadResult } from "@/types";

class DiscordService {
  private static _instance: DiscordService;
  private globalCooldownUntil = 0;
  private readonly UPLOAD_TIMEOUT = 30000;
  private readonly maxRetries = 3;
  private readonly BATCH_SIZE = 3;
  private readonly BATCH_DELAY = 600;

  private constructor() {}

  static get instance() {
    if (!this._instance) {
      this._instance = new DiscordService();
    }
    return this._instance;
  }

  private async checkCooldown(): Promise<void> {
    const now = Date.now();
    if (now < this.globalCooldownUntil) {
      const wait = this.globalCooldownUntil - now;
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private toArrayBuffer(u8: Uint8Array): ArrayBuffer {
    return u8.buffer.slice(
      u8.byteOffset,
      u8.byteOffset + u8.byteLength,
    ) as ArrayBuffer;
  }

  async deleteMessage(messageId: string, retryCount = 0): Promise<void> {
    await this.checkCooldown();
    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${config.DISCORD_CHANNEL_ID}/messages/${messageId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
          },
        },
      );
      if (!response.ok) {
        if (response.status === 404) {
          return;
        }
        if (response.status === 429 && retryCount < this.maxRetries) {
          const retryAfter =
            ((await response.json().catch(() => ({ retry_after: 1 })))
              ?.retry_after || 1) * 1000;
          this.globalCooldownUntil = Date.now() + retryAfter;
          logger.warn(`[Discord] Rate limited. Retrying after ${retryAfter}ms`);
          await new Promise((r) => setTimeout(r, retryAfter + 100));
          return this.deleteMessage(messageId, retryCount + 1);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      logger.debug(`[Discord] Message ${messageId} deleted successfully`);
    } catch (error) {
      if (error instanceof Error) {
        logger.error(
          `[Discord] Failed to delete msg ${messageId}:`,
          error.message,
        );
      } else {
        logger.error(
          `[Discord] Failed to delete msg ${messageId}:`,
          String(error),
        );
      }
    }
  }

  async uploadBuffer(
    buffer: Buffer | Uint8Array,
    filename: string,
    retryCount = 0,
  ): Promise<UploadResult> {
    await this.checkCooldown();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.UPLOAD_TIMEOUT);
    try {
      const formData = new FormData();
      let blobData: Uint8Array;
      if (buffer instanceof Buffer) {
        blobData = new Uint8Array(buffer);
      } else {
        blobData = buffer;
      }
      const arrayBuffer = this.toArrayBuffer(blobData);
      const blob = new Blob([arrayBuffer]);
      formData.append("files[0]", blob, filename);
      const response = await fetch(
        `https://discord.com/api/v10/channels/${config.DISCORD_CHANNEL_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`,
          },
          body: formData,
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);
      const status = response.status;
      if (status === 200 || status === 201) {
        const msg: DiscordMessage = await response.json();
        if (msg?.attachments?.[0]?.url) {
          logger.debug(
            `[Discord] Upload successful: ${msg.id} (${msg.attachments[0].filename})`,
          );
          return {
            id: msg.id,
            url: msg.attachments[0].url,
          };
        }
        throw new Error("No attachments in response");
      }
      if (status === 429) {
        let retryAfter = 1000;
        let isGlobal = false;
        try {
          const data: RateLimitData = await response.json();
          retryAfter = (data.retry_after || 1) * 1000;
          isGlobal = data.global || false;
          if (isGlobal) {
            this.globalCooldownUntil = Date.now() + retryAfter;
            logger.warn(
              `[Discord] Global rate limit hit. Cooldown: ${retryAfter}ms`,
            );
          }
        } catch {
          // Use defaults if parsing fails
        }
        if (retryCount < this.maxRetries) {
          logger.warn(
            `[Discord] Rate limited (${isGlobal ? "global" : "local"}). Retry ${retryCount + 1}/${this.maxRetries} after ${retryAfter}ms`,
          );
          await new Promise((r) => setTimeout(r, retryAfter + 100));
          return this.uploadBuffer(buffer, filename, retryCount + 1);
        }
      }
      if (status >= 500 && retryCount < this.maxRetries) {
        const retryAfter = 2000 * Math.pow(2, retryCount);
        logger.warn(
          `[Discord] Server error ${status}. Retry ${retryCount + 1}/${this.maxRetries} after ${retryAfter}ms`,
        );
        await new Promise((r) => setTimeout(r, retryAfter));
        return this.uploadBuffer(buffer, filename, retryCount + 1);
      }
      const errorText = await response.text().catch(() => response.statusText);
      throw new Error(`Discord Upload Failed (${status}): ${errorText}`);
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          if (retryCount < this.maxRetries) {
            logger.warn(
              `[Discord] Upload timeout. Retry ${retryCount + 1}/${this.maxRetries}`,
            );
            await new Promise((r) => setTimeout(r, 2000 * (retryCount + 1)));
            return this.uploadBuffer(buffer, filename, retryCount + 1);
          }
          throw new Error(`Upload timed out after ${this.maxRetries} retries`);
        }
        if (retryCount < this.maxRetries) {
          const retryAfter = 2000 * (retryCount + 1);
          logger.warn(
            `[Discord] Upload error: ${error.message}. Retry ${retryCount + 1}/${this.maxRetries} after ${retryAfter}ms`,
          );
          await new Promise((r) => setTimeout(r, retryAfter));
          return this.uploadBuffer(buffer, filename, retryCount + 1);
        }
        throw new Error(
          `Upload failed after ${this.maxRetries} retries: ${error.message}`,
        );
      }
      throw error;
    }
  }

  async bulkDeleteMessages(messageIds: string[]): Promise<void> {
    logger.log(`[Discord] Bulk deleting ${messageIds.length} messages...`);
    for (let i = 0; i < messageIds.length; i += this.BATCH_SIZE) {
      const batch = messageIds.slice(i, i + this.BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((id) => this.deleteMessage(id)),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          logger.error(
            `[Discord] Failed to delete message ${batch[index]}:`,
            result.reason,
          );
        }
      });
      if (i + this.BATCH_SIZE < messageIds.length) {
        await new Promise((r) => setTimeout(r, this.BATCH_DELAY));
      }
    }
    logger.log(
      `[Discord] Bulk delete completed for ${messageIds.length} messages`,
    );
  }
}

export default DiscordService;
