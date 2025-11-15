-- CreateTable
CREATE TABLE "public"."meli_oauth_state" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meli_oauth_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "meli_oauth_state_state_key" ON "public"."meli_oauth_state"("state");

-- CreateIndex
CREATE INDEX "meli_oauth_state_expires_at_idx" ON "public"."meli_oauth_state"("expires_at");

-- AddForeignKey
ALTER TABLE "public"."meli_oauth_state" ADD CONSTRAINT "meli_oauth_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
