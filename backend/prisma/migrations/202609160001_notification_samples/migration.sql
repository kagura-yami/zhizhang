CREATE TABLE "public"."notification_samples" (
  "id" SERIAL PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "sample_id" VARCHAR(64) NOT NULL,
  "package_name" VARCHAR(200) NOT NULL,
  "app_version" VARCHAR(30) NOT NULL,
  "rule_version" VARCHAR(50) NOT NULL,
  "posted_at" TIMESTAMPTZ(6) NOT NULL,
  "captured_at" TIMESTAMPTZ(6) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "reason" VARCHAR(200) NOT NULL,
  "raw" JSONB NOT NULL,
  "parsed" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "notification_samples_user_id_sample_id_key" ON "public"."notification_samples"("user_id", "sample_id");
CREATE INDEX "notification_samples_captured_at_id_idx" ON "public"."notification_samples"("captured_at", "id");
CREATE INDEX "notification_samples_user_id_captured_at_idx" ON "public"."notification_samples"("user_id", "captured_at");
CREATE INDEX "notification_samples_status_package_name_idx" ON "public"."notification_samples"("status", "package_name");
