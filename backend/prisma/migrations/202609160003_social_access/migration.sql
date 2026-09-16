-- CreateTable
CREATE TABLE "public"."social_preferences" (
    "user_id" UUID NOT NULL,
    "enabled_at" TIMESTAMPTZ(6) NOT NULL,
    "consent_version" VARCHAR(30) NOT NULL,
    "allow_ai_feedback" BOOLEAN NOT NULL DEFAULT false,
    "public_relations" BOOLEAN NOT NULL DEFAULT false,
    "ranking_scope" VARCHAR(10) NOT NULL DEFAULT 'none',
    "show_ranking_amount" BOOLEAN NOT NULL DEFAULT false,
    "notify_new_bills" BOOLEAN NOT NULL DEFAULT true,
    "notify_interactions" BOOLEAN NOT NULL DEFAULT true,
    "notification_preview" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "social_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "public"."social_follows" (
    "follower_id" UUID NOT NULL,
    "followee_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_follows_pkey" PRIMARY KEY ("follower_id","followee_id")
);

-- CreateTable
CREATE TABLE "public"."social_blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "public"."review_grants" (
    "owner_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "scope" VARCHAR(10) NOT NULL DEFAULT 'expense',
    "history_start" DATE,
    "activated_at" TIMESTAMPTZ(6) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_grants_pkey" PRIMARY KEY ("owner_id","reviewer_id")
);

-- CreateIndex
CREATE INDEX "social_follows_followee_id_follower_id_idx" ON "public"."social_follows"("followee_id", "follower_id");

-- CreateIndex
CREATE INDEX "social_blocks_blocked_id_blocker_id_idx" ON "public"."social_blocks"("blocked_id", "blocker_id");

-- CreateIndex
CREATE INDEX "review_grants_reviewer_id_status_idx" ON "public"."review_grants"("reviewer_id", "status");

-- AddForeignKey
ALTER TABLE "public"."social_preferences" ADD CONSTRAINT "social_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."social_follows" ADD CONSTRAINT "social_follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."social_follows" ADD CONSTRAINT "social_follows_followee_id_fkey" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."social_blocks" ADD CONSTRAINT "social_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."social_blocks" ADD CONSTRAINT "social_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_grants" ADD CONSTRAINT "review_grants_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_grants" ADD CONSTRAINT "review_grants_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
