-- CreateTable
CREATE TABLE "public"."new_bill_notices" (
    "id" SERIAL NOT NULL,
    "owner_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "grant_activated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "retry_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "new_bill_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."new_bill_notice_items" (
    "notice_id" INTEGER NOT NULL,
    "bill_id" INTEGER NOT NULL,

    CONSTRAINT "new_bill_notice_items_pkey" PRIMARY KEY ("notice_id","bill_id")
);

-- CreateIndex
CREATE INDEX "new_bill_notices_processed_at_due_at_id_idx" ON "public"."new_bill_notices"("processed_at", "due_at", "id");

-- CreateIndex
CREATE INDEX "new_bill_notices_owner_id_reviewer_id_processed_at_due_at_idx" ON "public"."new_bill_notices"("owner_id", "reviewer_id", "processed_at", "due_at");

-- CreateIndex
CREATE INDEX "new_bill_notice_items_bill_id_idx" ON "public"."new_bill_notice_items"("bill_id");

-- AddForeignKey
ALTER TABLE "public"."new_bill_notices" ADD CONSTRAINT "new_bill_notices_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."new_bill_notices" ADD CONSTRAINT "new_bill_notices_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."new_bill_notice_items" ADD CONSTRAINT "new_bill_notice_items_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "public"."new_bill_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."new_bill_notice_items" ADD CONSTRAINT "new_bill_notice_items_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
