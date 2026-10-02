-- 033 — environment-safe trigger URLs
--
-- Migrations 012/027/029/032 hard-coded the PRODUCTION project URL inside the
-- trigger functions, so a DEV database would have called production functions.
-- The base URL now comes from Vault (name: project_url), set once per
-- environment BEFORE this migration:
--     select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
-- If the secret is missing the trigger logs a WARNING and does nothing; it never
-- blocks an order update.

CREATE OR REPLACE FUNCTION private.project_url()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' $$;
REVOKE ALL ON FUNCTION private.project_url() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_whatsapp_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url TEXT := private.project_url();
BEGIN
  IF v_url IS NULL THEN RAISE WARNING 'project_url missing in Vault; whatsapp-notify not called'; RETURN NEW; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/whatsapp-notify',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', private.hook_secret('hook_whatsapp_notify')),
    body := jsonb_build_object('order_id', NEW.id, 'new_status', NEW.status,
                               'old_status', COALESCE(OLD.status, ''))
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.notify_order_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url TEXT := private.project_url();
BEGIN
  IF v_url IS NULL THEN RAISE WARNING 'project_url missing in Vault; order-email not called'; RETURN NEW; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/order-email',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', private.hook_secret('hook_order_email')),
    body := jsonb_build_object('order_id', NEW.id)
  );
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.trigger_order_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_url TEXT := private.project_url();
BEGIN
  IF v_url IS NULL THEN RAISE WARNING 'project_url missing in Vault; process-refund not called'; RETURN NEW; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/process-refund',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-hook-secret', private.hook_secret('hook_process_refund')),
    body := jsonb_build_object('order_id', NEW.id)
  );
  RETURN NEW;
END $$;
