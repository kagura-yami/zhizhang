-- Prior permission to use received feedback is not permission to send one's writing.
ALTER TABLE "social_preferences"
ADD COLUMN "allow_ai_authored_feedback" BOOLEAN NOT NULL DEFAULT false;
