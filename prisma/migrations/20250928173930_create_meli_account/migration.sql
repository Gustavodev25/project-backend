/*
  Warnings:

  - You are about to alter the column `country` on the `usuario` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(2)`.

*/
-- AlterTable
ALTER TABLE "public"."usuario" ALTER COLUMN "country" SET DATA TYPE VARCHAR(2),
ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "public"."meli_account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ml_user_id" INTEGER NOT NULL,
    "nickname" TEXT,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meli_account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meli_account_userId_ml_user_id_key" ON "public"."meli_account"("userId", "ml_user_id");

-- AddForeignKey
ALTER TABLE "public"."meli_account" ADD CONSTRAINT "meli_account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
