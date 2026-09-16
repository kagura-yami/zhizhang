-- AlterTable
ALTER TABLE "public"."social_preferences" ADD COLUMN     "request_cooldown_until" TIMESTAMPTZ(6),
ADD COLUMN     "request_reject_streak" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."review_requests" (
    "owner_id" UUID NOT NULL,
    "applicant_id" UUID NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(6),

    CONSTRAINT "review_requests_pkey" PRIMARY KEY ("owner_id","applicant_id")
);

-- CreateTable
CREATE TABLE "public"."social_inbox_events" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "dedupe_key" VARCHAR(200) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_inbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_requests_applicant_id_status_idx" ON "public"."review_requests"("applicant_id", "status");

-- CreateIndex
CREATE INDEX "review_requests_owner_id_status_requested_at_idx" ON "public"."review_requests"("owner_id", "status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "social_inbox_events_dedupe_key_key" ON "public"."social_inbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "social_inbox_events_user_id_id_idx" ON "public"."social_inbox_events"("user_id", "id");

-- AddForeignKey
ALTER TABLE "public"."review_requests" ADD CONSTRAINT "review_requests_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_requests" ADD CONSTRAINT "review_requests_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."social_inbox_events" ADD CONSTRAINT "social_inbox_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
