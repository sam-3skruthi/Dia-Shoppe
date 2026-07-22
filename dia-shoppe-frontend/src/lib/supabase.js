import { createClient } from '@supabase/supabase-js'

/*
  Single shared Supabase client. Reads the project URL + publishable (anon)
  key from Vite env vars — see .env. The anon key is safe to ship to the
  browser; all data access is enforced server-side by RLS policies.
*/
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
