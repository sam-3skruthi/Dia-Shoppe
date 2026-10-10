// courier-webhook — receives shipment status pushes from the courier and applies them to orders through ONE atomic database function
// (courier_apply_event). Provider-neutral on purpose: the provider has not been chosen, so no provider wording is built in.
//
// Configuration (function secrets):
//   COURIER_PROVIDER         key into courier_status_map (default "unconfigured": every status is recorded, none changes an order)
//   COURIER_AUTH_MODE        "token" (default) | "hmac"
//   COURIER_WEBHOOK_TOKEN    shared token (mode token), sent as x-api-key | x-webhook-token | Authorization: Bearer
//   COURIER_WEBHOOK_SECRET   HMAC key (mode hmac) ; COURIER_SIGNATURE_HEADER, COURIER_SIGNATURE_ENCODING (hex|base64), COURIER_SIGNATURE_PREFIX
// Fails closed when the credential for the chosen mode is missing. Answers 200 to authenticated calls it cannot use, so the courier does
// not retry forever; the outcome of every call is stored in courier_events.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { eventKey, extractGeneric, verifyCourierAuth } from "../_shared/courier.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const mode = (Deno.env.get("COURIER_AUTH_MODE") || "token").toLowerCase() === "hmac" ? "hmac" : "token";
  const raw = new Uint8Array(await req.arrayBuffer());
  const auth = await verifyCourierAuth(req.headers, raw, {
    mode, secret: mode === "hmac" ? Deno.env.get("COURIER_WEBHOOK_SECRET") : Deno.env.get("COURIER_WEBHOOK_TOKEN"),
    signatureHeader: Deno.env.get("COURIER_SIGNATURE_HEADER") || undefined,
    encoding: Deno.env.get("COURIER_SIGNATURE_ENCODING") === "base64" ? "base64" : "hex",
    prefix: Deno.env.get("COURIER_SIGNATURE_PREFIX") || undefined,
  });
  if (!auth.ok) { console.warn("courier-webhook rejected:", auth.reason); return json({ error: "unauthorized" }, 401); }

  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ received: true, ignored: "not json" }); }
  const provider = (Deno.env.get("COURIER_PROVIDER") || "unconfigured").toLowerCase();
  const e = extractGeneric(body);
  if (!e.status || (!e.orderRef && !e.awb)) return json({ received: true, ignored: "missing status or order reference" });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await sb.rpc("courier_apply_event", {
    p_provider: provider, p_event_key: await eventKey(provider, e), p_order_ref: e.orderRef, p_awb: e.awb, p_raw_status: e.status, p_courier: e.courier,
  });
  if (error) { console.error("courier_apply_event failed:", error.message); return json({ error: "temporary failure" }, 500); }   // courier retries
  return json({ received: true, ...data });
});
