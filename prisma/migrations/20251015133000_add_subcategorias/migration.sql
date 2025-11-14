-- AlterTable
ALTER TABLE "categoria" ADD COLUMN "categoria_pai_id" TEXT;

-- CreateIndex
CREATE INDEX "categoria_categoria_pai_id_idx" ON "categoria"("categoria_pai_id");

-- AddForeignKey
ALTER TABLE "categoria" ADD CONSTRAINT "categoria_categoria_pai_id_fkey" FOREIGN KEY ("categoria_pai_id") REFERENCES "categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
