-- 020 — Instagram / Facebook management (social inbox + connection state)
-- Stores which social accounts are connected and the incoming comments/DMs a
-- Meta webhook forwards, so staff can read and reply from the dashboard.
-- Live data flows once the Meta app is verified and the Page/IG account is
-- connected; until then these tables simply stay empty.

CREATE TABLE IF NOT EXISTS public.social_accounts (
  platform     TEXT PRIMARY KEY CHECK (platform IN ('instagram', 'facebook')),
  connected    BOOLEAN NOT NULL DEFAULT false,
  account_name TEXT,
  account_id   TEXT,          -- IG business id / FB page id
  connected_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.social_messages (
  id          BIGSERIAL PRIMARY KEY,
  platform    TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  kind        TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment', 'dm')),
  external_id TEXT UNIQUE,     -- Meta object id, for idempotent webhook inserts
  from_name   TEXT,
  from_id     TEXT,
  text        TEXT,
  permalink   TEXT,
  replied     BOOLEAN NOT NULL DEFAULT false,
  reply_text  TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_messages_received ON public.social_messages (received_at DESC);

-- Seed the two platform rows so the UI always has a status to show.
INSERT INTO public.social_accounts (platform) VALUES ('instagram'), ('facebook')
  ON CONFLICT (platform) DO NOTHING;

-- RLS: admin-only (the whole feature is staff-facing).
ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage social accounts" ON public.social_accounts
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "Admins read social messages" ON public.social_messages
  FOR SELECT USING (public.is_admin());
CREATE POLICY "Admins update social messages" ON public.social_messages
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());
