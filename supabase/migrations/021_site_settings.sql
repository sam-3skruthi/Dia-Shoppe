-- 021 — site settings (global key/value) for the admin-controlled sale theme
-- The storefront can switch to a "sale" design in two ways:
--   • automatically, whenever a sale event is active (handled in the app), or
--   • manually, when an admin forces it here (overrides / previews the theme).
-- Public read (the storefront needs it); admin-only write.

CREATE TABLE IF NOT EXISTS public.site_settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT 'false'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.site_settings (key, value) VALUES ('sale_theme_forced', 'false'::jsonb)
  ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read settings" ON public.site_settings
  FOR SELECT USING (true);
CREATE POLICY "Admins can change settings" ON public.site_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
