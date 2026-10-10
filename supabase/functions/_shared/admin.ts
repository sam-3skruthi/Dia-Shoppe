import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Browser-invoked admin functions: the caller's own JWT is verified and must belong to an admin profile.
export async function requireAdmin(req: Request): Promise<{ ok: true; userId: string } | { ok: false; res: Response }> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return { ok: false, res: jsonResponse({ error: "Unauthorized" }, 401) };
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: me } = await admin.from("user_profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") return { ok: false, res: jsonResponse({ error: "Forbidden" }, 403) };
  return { ok: true, userId: user.id };
}
