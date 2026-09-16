-- CreateTable
CREATE TABLE "public"."review_reports" (
    "id" SERIAL NOT NULL,
    "reporter_id" UUID,
    "thread_id" INTEGER,
    "message_id" INTEGER,
    "original_message_id" INTEGER NOT NULL,
    "reported_revision" INTEGER NOT NULL,
    "owner_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "disclosure_version" VARCHAR(30) NOT NULL,
    "decision_reason" TEXT,
    "decided_by" VARCHAR(100),
    "decided_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_report_evidence" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "original_message_id" INTEGER NOT NULL,
    "author_id" UUID NOT NULL,
    "is_main" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "withdrawn" BOOLEAN NOT NULL,
    "hidden" BOOLEAN NOT NULL,
    "revision" INTEGER NOT NULL,
    "versions" JSONB NOT NULL,
    "message_created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "review_report_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."review_moderation_audit" (
    "id" SERIAL NOT NULL,
    "report_id" INTEGER NOT NULL,
    "actor" VARCHAR(100) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_moderation_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_reports_status_id_idx" ON "public"."review_reports"("status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_reporter_id_original_message_id_reported_rev_key" ON "public"."review_reports"("reporter_id", "original_message_id", "reported_revision");

-- CreateIndex
CREATE UNIQUE INDEX "review_report_evidence_report_id_original_message_id_key" ON "public"."review_report_evidence"("report_id", "original_message_id");

-- CreateIndex
CREATE INDEX "review_moderation_audit_report_id_id_idx" ON "public"."review_moderation_audit"("report_id", "id");

-- AddForeignKey
ALTER TABLE "public"."review_reports" ADD CONSTRAINT "review_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_reports" ADD CONSTRAINT "review_reports_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."bill_review_threads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_reports" ADD CONSTRAINT "review_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."review_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_report_evidence" ADD CONSTRAINT "review_report_evidence_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."review_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."review_moderation_audit" ADD CONSTRAINT "review_moderation_audit_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "public"."review_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
