-- CreateTable
CREATE TABLE "File" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "type" TEXT,
    "folder_id" TEXT,
    "iv" TEXT,
    "date" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" BIGSERIAL NOT NULL,
    "file_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "message_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "iv" TEXT,
    "size" BIGINT NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "File_folder_id_idx" ON "File"("folder_id");

-- CreateIndex
CREATE INDEX "Chunk_file_id_idx" ON "Chunk"("file_id");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
