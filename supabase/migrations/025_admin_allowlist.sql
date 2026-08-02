-- 025 — lock the admin dashboard to an explicit allow-list of emails
--
-- Only these three accounts may ever hold role='admin':
--   rsamskruthi8@gmail.com, diashoppe@gmail.com, sandeephms77@gmail.com
--
-- Three parts:
--   1. promote those emails if they have already signed up
--   2. demote anybody else who somehow holds admin
--   3. make the signup trigger assign the role automatically, so the two new
--      owners become admins the moment they register (no manual step, and no
--      window where they sign up as a normal customer)

-- 1 + 2 — reconcile existing rows
UPDATE public.user_profiles
   SET role = 'admin'
 WHERE lower(email) IN ('rsamskruthi8@gmail.com', 'diashoppe@gmail.com', 'sandeephms77@gmail.com')
   AND role IS DISTINCT FROM 'admin';

UPDATE public.user_profiles
   SET role = 'customer'
 WHERE role = 'admin'
   AND lower(coalesce(email, '')) NOT IN ('rsamskruthi8@gmail.com', 'diashoppe@gmail.com', 'sandeephms77@gmail.com');

-- 3 — auto-assign on signup (keeps the rest of the original trigger behaviour)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, first_name, last_name, email, phone, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'last_name',
    NEW.email,
    NEW.raw_user_meta_data ->> 'phone',
    CASE
      WHEN lower(NEW.email) IN ('rsamskruthi8@gmail.com', 'diashoppe@gmail.com', 'sandeephms77@gmail.com')
        THEN 'admin'
      ELSE 'customer'
    END
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
