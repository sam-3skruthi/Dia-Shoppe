// Dia Shoppe — receives Instagram/Facebook webhooks (comments & DMs) from Meta
// and stores them in social_messages so staff can reply from the dashboard.
// GET  = Meta's verification handshake.
// POST = incoming events → upsert into social_messages (idempotent on Meta id).
// Deploy with --no-verify-jwt (Meta calls it directly with no Supabase JWT).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERIFY_TOKEN = Deno.env.get("SOCIAL_VERIFY_TOKEN")!;

serve(async (req) => {
  const url = new URL(req.url);

  // 1 — verification handshake
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge || "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // 2 — incoming events
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const body = await req.json();
    const rows: any[] = [];

    for (const entry of body.entry || []) {
      // Comments (IG & FB Pages send these under "changes")
      for (const change of entry.changes || []) {
        const v = change.value || {};
        if (change.field === "comments" || v.item === "comment") {
          rows.push({
            platform: body.object?.includes("instagram") ? "instagram" : "facebook",
            kind: "comment",
            external_id: v.id || v.comment_id,
            from_name: v.from?.name || v.from?.username || null,
            from_id: v.from?.id || null,
            text: v.text || v.message || "",
            permalink: v.permalink || null,
          });
        }
      }
      // Direct messages (Messenger / IG messaging)
      for (const m of entry.messaging || []) {
        if (m.message?.text) {
          rows.push({
            platform: entry.messaging_product === "instagram" ? "instagram" : "facebook",
            kind: "dm",
            external_id: m.message.mid,
            from_id: m.sender?.id || null,
            text: m.message.text,
          });
        }
      }
    }

    if (rows.length) {
      // idempotent — ignore events Meta re-delivers
      await supabase.from("social_messages").upsert(rows, { onConflict: "external_id", ignoreDuplicates: true });
    }
    return new Response(JSON.stringify({ received: rows.length }), { status: 200 });
  } catch (error) {
    console.error("social-webhook error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 200 }); // 200 so Meta doesn't retry-storm
  }
});
