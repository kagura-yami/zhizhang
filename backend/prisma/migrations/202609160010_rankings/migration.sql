CREATE TABLE public.ranking_launch (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  launched_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public.ranking_launch (id) VALUES (1);
CREATE TABLE public.ranking_states (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  initialized BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  day_key VARCHAR(10) NOT NULL,
  month_key VARCHAR(7) NOT NULL,
  year_key VARCHAR(4) NOT NULL
);
CREATE TABLE public.ranking_results (
  user_id UUID NOT NULL REFERENCES public.ranking_states(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind VARCHAR(5) NOT NULL CHECK (kind IN ('day','month','year')),
  period VARCHAR(10) NOT NULL,
  surplus DECIMAL(30,4) NOT NULL,
  effective_days INTEGER NOT NULL CHECK (effective_days >= 0),
  included INTEGER NOT NULL CHECK (included >= 0),
  needs_review INTEGER NOT NULL CHECK (needs_review >= 0),
  rule_version VARCHAR(30) NOT NULL,
  PRIMARY KEY(user_id, kind, period)
);
CREATE INDEX ranking_results_kind_period_surplus_effective_days_idx ON public.ranking_results(kind, period, surplus, effective_days);
-- Explicit pre-existing opt-ins start at deployment, never at account creation.
INSERT INTO public.ranking_states(user_id, day_key, month_key, year_key)
SELECT user_id, to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'),
  to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM'),
  to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Shanghai', 'YYYY')
FROM public.social_preferences WHERE ranking_scope IN ('friends','global');
