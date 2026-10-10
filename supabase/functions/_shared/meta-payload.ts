// Parses a WhatsApp Cloud API webhook body into messages and statuses. Pure (unit-tested with fixtures shaped like Meta's documented
// payloads; the real-capture check is the DEV round trip, see META_REAL_INTEGRATION_RUNBOOK.md).
export type ParsedMessage = { id: string; from: string; type: string; text: string; media: { id: string; mime_type: string | null; sha256: string | null } | null };
export type ParsedStatus = { id: string; status: string; ts: string; clientRef: string | null; errorCode: number | null; errorMessage: string | null; recipient: string | null };
export type Parsed = { messages: ParsedMessage[]; statuses: ParsedStatus[]; errors: { code: number | null; title: string | null }[]; skipped: number };

// deno-lint-ignore no-explicit-any
function bodyText(msg: any): string {
  switch (msg.type) {
    case "text": return String(msg.text?.body ?? "");
    case "button": return String(msg.button?.text ?? msg.button?.payload ?? "");                       // quick-reply tap on a template
    case "interactive": return String(msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "");
    default: return String(msg[msg.type]?.caption ?? "");                                                // image/video/document captions
  }
}

// deno-lint-ignore no-explicit-any
export function parseWhatsAppWebhook(payload: any): Parsed {
  const out: Parsed = { messages: [], statuses: [], errors: [], skipped: 0 };
  if (payload?.object !== "whatsapp_business_account") { out.skipped++; return out; }
  for (const entry of payload.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field && change.field !== "messages") { out.skipped++; continue; }        // template status updates, account alerts, ...
      const value = change?.value ?? {};
      for (const e of value.errors ?? []) out.errors.push({ code: typeof e?.code === "number" ? e.code : null, title: e?.title ?? null });
      for (const msg of value.messages ?? []) {
        if (typeof msg?.id !== "string" || typeof msg?.from !== "string") { out.skipped++; continue; }
        const type = String(msg.type ?? "unknown");
        const m = msg[type];
        out.messages.push({
          id: msg.id, from: msg.from, type, text: bodyText(msg),
          media: m && typeof m === "object" && m.id ? { id: String(m.id), mime_type: m.mime_type ?? null, sha256: m.sha256 ?? null } : null,
        });
      }
      for (const st of value.statuses ?? []) {
        if (typeof st?.id !== "string" || typeof st?.status !== "string") { out.skipped++; continue; }
        const err = st.errors?.[0];
        out.statuses.push({
          id: st.id, status: st.status,
          ts: st.timestamp && /^\d+$/.test(String(st.timestamp)) ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString(),
          clientRef: typeof st.biz_opaque_callback_data === "string" ? st.biz_opaque_callback_data : null,
          errorCode: typeof err?.code === "number" ? err.code : null,
          errorMessage: (err?.error_data?.details ?? err?.message ?? err?.title ?? null) as string | null,
          recipient: typeof st.recipient_id === "string" ? st.recipient_id : null,
        });
      }
    }
  }
  return out;
}
