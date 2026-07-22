-- Dia Shoppe — Table-level grants for Supabase API roles
-- The API roles (anon = logged-out, authenticated = logged-in) need base
-- table privileges before RLS policies even come into play. Projects normally
-- get these via default privileges; our hand-run schema missed them.
-- RLS still controls WHICH ROWS each user can touch — these grants only
-- allow the roles to use the tables at all.

GRANT USAGE ON SCHEMA public TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;

-- BIGSERIAL ids need sequence access for inserts
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Cover any tables/sequences added in future migrations automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
