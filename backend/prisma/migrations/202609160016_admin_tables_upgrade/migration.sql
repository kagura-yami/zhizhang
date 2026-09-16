-- Some installations already created these tables via schema synchronization.
-- Preserve those tables and rows; complete the formal upgrade path for older installations.
BEGIN;
CREATE TABLE IF NOT EXISTS "public"."system_settings" (
  "id" SERIAL NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "value" JSONB NOT NULL,
  "category" VARCHAR(50) NOT NULL DEFAULT 'general',
  "description" VARCHAR(500),
  "is_secret" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_key_key" ON "public"."system_settings"("key");
CREATE INDEX IF NOT EXISTS "system_settings_category_idx" ON "public"."system_settings"("category");

CREATE TABLE IF NOT EXISTS "public"."admin_issues" (
  "id" SERIAL NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" TEXT,
  "type" VARCHAR(30) NOT NULL DEFAULT 'bug',
  "status" VARCHAR(30) NOT NULL DEFAULT 'todo',
  "priority" VARCHAR(20) NOT NULL DEFAULT 'medium',
  "target_version" VARCHAR(20),
  "assignee" VARCHAR(100),
  "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "resolved_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "admin_issues_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "admin_issues_status_priority_idx" ON "public"."admin_issues"("status", "priority");
CREATE INDEX IF NOT EXISTS "admin_issues_target_version_idx" ON "public"."admin_issues"("target_version");

-- Align the original 001 FK with Prisma's relation update policy.
ALTER TABLE "public"."notification_samples" DROP CONSTRAINT "notification_samples_user_id_fkey";
ALTER TABLE "public"."notification_samples" ADD CONSTRAINT "notification_samples_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
