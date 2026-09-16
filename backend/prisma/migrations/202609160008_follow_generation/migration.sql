-- AlterTable
ALTER TABLE "public"."social_follows" ADD COLUMN     "generation" UUID NOT NULL DEFAULT gen_random_uuid();
