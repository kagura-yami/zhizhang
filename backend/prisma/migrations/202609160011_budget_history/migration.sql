BEGIN;
-- Keep seed and trigger installation atomic with respect to budget writes.
LOCK TABLE "budgets" IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE "budget_history_launch" (
  "id" INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "budget_revisions" (
  "id" BIGSERIAL PRIMARY KEY,
  "budget_id" INTEGER NOT NULL,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "action" VARCHAR(20) NOT NULL,
  "snapshot" JSONB NOT NULL
);
CREATE INDEX "budget_revisions_user_id_budget_id_recorded_at_idx"
  ON "budget_revisions"("user_id", "budget_id", "recorded_at");
INSERT INTO "budget_history_launch" (id, started_at) VALUES (1, clock_timestamp());
-- This is knowledge available at deployment, NOT a reconstruction of past budgets.
INSERT INTO "budget_revisions" (budget_id,user_id,recorded_at,action,snapshot)
SELECT b.id,b.user_id,l.started_at,'baseline',to_jsonb(b) || jsonb_build_object('amount',b.amount::text)
FROM budgets b CROSS JOIN budget_history_launch l;

CREATE FUNCTION capture_budget_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data budgets%ROWTYPE;
  event_action TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := OLD;
    event_action := 'delete';
  ELSE
    row_data := NEW;
    event_action := lower(TG_OP);
    IF TG_OP = 'UPDATE' AND
      (to_jsonb(OLD) - 'updated_at') = (to_jsonb(NEW) - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  -- Account deletion cascades history; do not recreate history for a gone owner.
  IF EXISTS (SELECT 1 FROM users WHERE id = row_data.user_id) THEN
    INSERT INTO budget_revisions (budget_id,user_id,recorded_at,action,snapshot)
    VALUES (row_data.id,row_data.user_id,clock_timestamp(),event_action,
      to_jsonb(row_data) || jsonb_build_object('amount',row_data.amount::text));
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER budget_revision_capture AFTER INSERT OR UPDATE OR DELETE ON budgets
  FOR EACH ROW EXECUTE FUNCTION capture_budget_revision();

-- A removed category must not silently turn its budget into a total budget.
CREATE FUNCTION deactivate_orphaned_budget() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.category_id IS NOT NULL AND NEW.category_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM categories WHERE id = OLD.category_id) THEN
    NEW.is_active := false;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER budget_category_removed BEFORE UPDATE ON budgets
  FOR EACH ROW EXECUTE FUNCTION deactivate_orphaned_budget();
COMMIT;
