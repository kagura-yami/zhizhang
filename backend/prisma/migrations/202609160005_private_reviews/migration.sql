-- CreateTable
CREATE TABLE "public"."bill_review_threads" (
    "id" SERIAL NOT NULL,
    "owner_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "bill_id" INTEGER,
    "original_bill_id" INTEGER NOT NULL,
    "vote" VARCHAR(5) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "initial_bill_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "snapshot_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_review_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_messages" (
    "id" SERIAL NOT NULL,
    "thread_id" INTEGER NOT NULL,
    "author_id" UUID NOT NULL,
    "client_key" UUID NOT NULL,
    "main_slot" INTEGER,
    "body" TEXT NOT NULL,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_message_versions" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "withdrawn" BOOLEAN NOT NULL,
    "action" VARCHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_message_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bill_review_threads_owner_id_id_idx" ON "public"."bill_review_threads"("owner_id", "id");

-- CreateIndex
CREATE INDEX "bill_review_threads_reviewer_id_id_idx" ON "public"."bill_review_threads"("reviewer_id", "id");

-- CreateIndex
CREATE INDEX "bill_review_threads_bill_id_idx" ON "public"."bill_review_threads"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_review_threads_original_bill_id_reviewer_id_key" ON "public"."bill_review_threads"("original_bill_id", "reviewer_id");

-- CreateIndex
CREATE INDEX "review_messages_thread_id_id_idx" ON "public"."review_messages"("thread_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "review_messages_thread_id_main_slot_key" ON "public"."review_messages"("thread_id", "main_slot");

-- CreateIndex
CREATE UNIQUE INDEX "review_messages_thread_id_author_id_client_key_key" ON "public"."review_messages"("thread_id", "author_id", "client_key");

-- CreateIndex
CREATE UNIQUE INDEX "review_message_versions_message_id_revision_key" ON "public"."review_message_versions"("message_id", "revision");

-- AddForeignKey
ALTER TABLE "public"."bill_review_threads" ADD CONSTRAINT "bill_review_threads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bill_review_threads" ADD CONSTRAINT "bill_review_threads_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."bill_review_threads" ADD CONSTRAINT "bill_review_threads_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_messages" ADD CONSTRAINT "review_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."bill_review_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_messages" ADD CONSTRAINT "review_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_message_versions" ADD CONSTRAINT "review_message_versions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."review_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
