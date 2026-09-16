BEGIN;
CREATE TABLE retrospective_jobs (
  id UUID PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  client_key UUID NOT NULL, kind VARCHAR(5) NOT NULL, period VARCHAR(10) NOT NULL,
  config_id INTEGER NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
  lease_token UUID, lease_until TIMESTAMPTZ(6), error_code VARCHAR(30), sources JSONB, result JSONB,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT retrospective_jobs_user_id_client_key_key UNIQUE(user_id,client_key)
);
CREATE INDEX retrospective_jobs_user_id_created_at_idx ON retrospective_jobs(user_id,created_at);
CREATE INDEX retrospective_jobs_status_created_at_idx ON retrospective_jobs(status,created_at);
CREATE INDEX retrospective_jobs_sources_idx ON retrospective_jobs USING GIN(sources);

-- Once private evidence is withdrawn, restoring consent never resurrects an old report.
CREATE FUNCTION invalidate_retrospective_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.hidden AND NOT OLD.hidden) OR (NEW.withdrawn AND NOT OLD.withdrawn) THEN
    UPDATE retrospective_jobs SET status='invalidated', result=NULL, error_code='evidence_unavailable',
      lease_token=NULL, lease_until=NULL, updated_at=clock_timestamp()
    WHERE status IN ('running','succeeded') AND sources @> jsonb_build_array(jsonb_build_object('kind','message','id',NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retrospective_message_invalidated AFTER UPDATE ON review_messages
FOR EACH ROW EXECUTE FUNCTION invalidate_retrospective_message();

CREATE FUNCTION invalidate_retrospective_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR (OLD.allow_ai_authored_feedback AND NOT NEW.allow_ai_authored_feedback) THEN
    UPDATE retrospective_jobs SET status='invalidated',result=NULL,error_code='evidence_unavailable',
      lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE status IN ('running','succeeded') AND sources @> jsonb_build_array(jsonb_build_object('authorId',OLD.user_id::text));
  END IF;
  IF TG_OP='DELETE' OR (OLD.allow_ai_feedback AND NOT NEW.allow_ai_feedback) THEN
    UPDATE retrospective_jobs SET status='invalidated',result=NULL,error_code='evidence_unavailable',
      lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE user_id=OLD.user_id AND status IN ('running','succeeded')
      AND (sources @> '[{"kind":"message"}]'::jsonb OR sources @> '[{"kind":"vote"}]'::jsonb);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER retrospective_consent_invalidated AFTER UPDATE OR DELETE ON social_preferences
FOR EACH ROW EXECUTE FUNCTION invalidate_retrospective_consent();

CREATE FUNCTION invalidate_retrospective_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    UPDATE retrospective_jobs SET status='invalidated',result=NULL,error_code='evidence_unavailable',
      lease_token=NULL,lease_until=NULL,updated_at=clock_timestamp()
    WHERE status IN ('running','succeeded') AND sources @> jsonb_build_array(jsonb_build_object('authorId',OLD.id::text));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retrospective_account_invalidated AFTER UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION invalidate_retrospective_account();
COMMIT;
