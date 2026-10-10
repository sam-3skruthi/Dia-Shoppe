// Dia Shoppe — WhatsApp queue worker. Called by pg_cron every minute (x-hook-secret from Vault) and safe to call by hand.
// Claims due rows with a lease (FOR UPDATE SKIP LOCKED), sends outbound messages through the shared sender, runs inbound jobs
// (consent keywords, guarded AI answer), recovers stale leases. Idempotent: running it twice at once cannot double-send.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { constantTimeEqual } from "../_shared/meta-signature.ts";
import { processBatch } from "../_shared/whatsapp-pipeline.ts";

const SECRET = Deno.env.get("WHATSAPP_WORKER_SECRET");
const env = (k: string) => Deno.env.get(k);

serve(async (req) => {
  const given = req.headers.get("x-hook-secret") ?? "";
  if (!SECRET || !constantTimeEqual(given, SECRET)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const result = await processBatch(sb, env);
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("whatsapp-worker error:", (e as Error).message);
    return new Response(JSON.stringify({ error: "worker failed" }), { status: 500 });
  }
});
