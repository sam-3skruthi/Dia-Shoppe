// Parser + signature tests over payloads SHAPED like Meta's documented WhatsApp Cloud API webhooks, plus courier helper tests.
// IMPORTANT: these fixtures are written from Meta's documentation, NOT captured from Meta. They prove the parser handles the documented
// shapes; they do not prove Meta's real traffic. The DEV round trip (META_REAL_INTEGRATION_RUNBOOK.md) captures real payloads for that.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { parseWhatsAppWebhook } from "../../functions/_shared/meta-payload.ts";
import { verifyMetaSignature } from "../../functions/_shared/meta-signature.ts";
import { classifyMetaError } from "../../functions/_shared/whatsapp.ts";
import { verifyCourierAuth, extractGeneric, eventKey } from "../../functions/_shared/courier.ts";

const WAMID = "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQUZCMTY0MDc2MUYwNzBDNTY5MAA=";           // real wamids are base64-ish and end in "="
const wrap = (value) => ({ object: "whatsapp_business_account", entry: [{ id: "102290129340398", changes: [{ value: { messaging_product: "whatsapp", metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" }, ...value }, field: "messages" }] }] });
const contacts = [{ profile: { name: "Sheena Nelson" }, wa_id: "16505551234" }];
const msg = (o) => wrap({ contacts, messages: [{ from: "16505551234", id: WAMID, timestamp: "1749416383", ...o }] });

test("text message (with contacts block)", () => {
  const p = parseWhatsAppWebhook(msg({ type: "text", text: { body: "Does it come in another color?" } }));
  assert.deepEqual(p.messages, [{ id: WAMID, from: "16505551234", type: "text", text: "Does it come in another color?", media: null }]);
});
test("reply-to-message context and referral blocks are ignored, text kept", () => {
  const p = parseWhatsAppWebhook(msg({ type: "text", text: { body: "yes" }, context: { from: "15550783881", id: "wamid.PREV" }, referral: { source_url: "https://x", source_type: "ad" } }));
  assert.equal(p.messages[0].text, "yes");
});
test("template quick-reply button and interactive replies yield their visible text", () => {
  assert.equal(parseWhatsAppWebhook(msg({ type: "button", button: { payload: "No", text: "No thanks" } })).messages[0].text, "No thanks");
  assert.equal(parseWhatsAppWebhook(msg({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "1", title: "Track order" } } })).messages[0].text, "Track order");
  assert.equal(parseWhatsAppWebhook(msg({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "a", title: "Returns" } } })).messages[0].text, "Returns");
});
test("media: metadata only (id, mime, sha256), caption as text, no URL", () => {
  const p = parseWhatsAppWebhook(msg({ type: "image", image: { caption: "broken screen", mime_type: "image/jpeg", sha256: "abc=", id: "1003383421387256" } }));
  assert.deepEqual(p.messages[0].media, { id: "1003383421387256", mime_type: "image/jpeg", sha256: "abc=" });
  assert.equal(p.messages[0].text, "broken screen");
  for (const [type, body] of [["audio", { id: "1", mime_type: "audio/ogg; codecs=opus", voice: true }], ["document", { id: "2", filename: "a.pdf", mime_type: "application/pdf" }], ["sticker", { id: "3", mime_type: "image/webp" }], ["video", { id: "4", mime_type: "video/mp4" }]])
    assert.equal(parseWhatsAppWebhook(msg({ type, [type]: body })).messages[0].media.id, body.id);
});
test("reaction, location, contacts, unsupported are parsed (the worker decides what to do)", () => {
  assert.equal(parseWhatsAppWebhook(msg({ type: "reaction", reaction: { message_id: "wamid.X", emoji: "👍" } })).messages[0].type, "reaction");
  assert.equal(parseWhatsAppWebhook(msg({ type: "location", location: { latitude: 1, longitude: 2 } })).messages[0].type, "location");
  assert.equal(parseWhatsAppWebhook(msg({ type: "unsupported", errors: [{ code: 131051, title: "Message type is not supported" }] })).messages[0].type, "unsupported");
});
test("statuses: sent / delivered / read with conversation + pricing blocks", () => {
  const st = (status) => wrap({ statuses: [{ id: WAMID, status, timestamp: "1750263773", recipient_id: "16505551234", conversation: { id: "c1", origin: { type: "utility" } }, pricing: { billable: true, pricing_model: "CBP", category: "utility" }, biz_opaque_callback_data: "wa-abc123" }] });
  for (const s of ["sent", "delivered", "read"]) {
    const p = parseWhatsAppWebhook(st(s));
    assert.equal(p.statuses[0].status, s); assert.equal(p.statuses[0].clientRef, "wa-abc123"); assert.equal(p.statuses[0].ts, "2025-06-18T16:22:53.000Z");
  }
});
test("failed status carries Meta's error code and details", () => {
  const p = parseWhatsAppWebhook(wrap({ statuses: [{ id: WAMID, status: "failed", timestamp: "1750263773", recipient_id: "16505551234", errors: [{ code: 131026, title: "Message undeliverable", message: "Message undeliverable", error_data: { details: "Message Undeliverable." } }] }] }));
  assert.equal(p.statuses[0].errorCode, 131026); assert.equal(p.statuses[0].errorMessage, "Message Undeliverable.");
});
test("webhook-level errors, other fields and foreign objects do not crash and store nothing", () => {
  assert.equal(parseWhatsAppWebhook(wrap({ errors: [{ code: 131000, title: "Something went wrong" }] })).errors[0].code, 131000);
  const other = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "message_template_status_update", value: { event: "APPROVED", message_template_name: "order_update" } }] }] };
  const p = parseWhatsAppWebhook(other); assert.equal(p.messages.length + p.statuses.length, 0); assert.equal(p.skipped, 1);
  assert.equal(parseWhatsAppWebhook({ object: "instagram", entry: [] }).skipped, 1);
  assert.equal(parseWhatsAppWebhook(null).messages.length, 0); assert.equal(parseWhatsAppWebhook({}).messages.length, 0);
  assert.equal(parseWhatsAppWebhook(wrap({ messages: [{ type: "text", text: { body: "no id" } }] })).skipped, 1);
});
test("one body with several messages AND statuses (batched delivery)", () => {
  const body = wrap({ contacts, messages: [{ from: "1", id: "wamid.A", timestamp: "1", type: "text", text: { body: "a" } }, { from: "2", id: "wamid.B", timestamp: "1", type: "text", text: { body: "b" } }], statuses: [{ id: "wamid.C", status: "sent", timestamp: "1", recipient_id: "3" }] });
  const p = parseWhatsAppWebhook(body); assert.equal(p.messages.length, 2); assert.equal(p.statuses.length, 1);
});
test("signature over a realistic body: valid, and a one-byte change anywhere is rejected", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(msg({ type: "text", text: { body: "नमस्ते 👋" } })));
  const sig = "sha256=" + createHmac("sha256", "meta-app-secret").update(bytes).digest("hex");
  assert.equal((await verifyMetaSignature(bytes, sig, "meta-app-secret")).ok, true);
  for (const i of [0, 10, Math.floor(bytes.length / 2), bytes.length - 1]) { const t = new Uint8Array(bytes); t[i] ^= 1; assert.equal((await verifyMetaSignature(t, sig, "meta-app-secret")).ok, false, `byte ${i}`); }
  assert.equal((await verifyMetaSignature(bytes, sig, "other-secret")).ok, false);
});
test("Meta error classification for the codes seen in a real test-number setup", () => {
  const c = (code, http = 400) => classifyMetaError(http, { error: { code } });
  assert.equal(c(131030).retryable, false);            // recipient not in the allowed list (test numbers): permanent
  assert.equal(c(131047).retryable, false);            // outside the 24 h window
  assert.equal(c(132001).retryable, false);            // template missing for this language
  assert.equal(c(132012).retryable, false);            // parameter format mismatch
  assert.equal(c(130429, 429).retryable, true);        // throughput
  assert.equal(c(190, 401).pauseQueue, true);          // token
  assert.equal(c(0, 503).retryable, true);
});

// ---------------- courier helpers
const hdr = (o) => new Headers(o);
const body = new TextEncoder().encode('{"awb":"A1","status":"x"}');
test("courier auth: token mode (three header styles), constant-time, fails closed", async () => {
  const cfg = { mode: "token", secret: "tok123" };
  assert.equal((await verifyCourierAuth(hdr({ "x-api-key": "tok123" }), body, cfg)).ok, true);
  assert.equal((await verifyCourierAuth(hdr({ "x-webhook-token": "tok123" }), body, cfg)).ok, true);
  assert.equal((await verifyCourierAuth(hdr({ authorization: "Bearer tok123" }), body, cfg)).ok, true);
  assert.equal((await verifyCourierAuth(hdr({ "x-api-key": "nope" }), body, cfg)).reason, "bad_token");
  assert.equal((await verifyCourierAuth(hdr({}), body, cfg)).reason, "missing_token");
  assert.equal((await verifyCourierAuth(hdr({ "x-api-key": "tok123" }), body, { mode: "token", secret: undefined })).reason, "not_configured");
});
test("courier auth: hmac mode (hex and base64, prefix), body tamper rejected", async () => {
  const h = createHmac("sha256", "k").update(body).digest();
  const hex = h.toString("hex"), b64 = h.toString("base64");
  assert.equal((await verifyCourierAuth(hdr({ "x-sig": hex }), body, { mode: "hmac", secret: "k", signatureHeader: "x-sig" })).ok, true);
  assert.equal((await verifyCourierAuth(hdr({ "x-sig": "sha256=" + hex }), body, { mode: "hmac", secret: "k", signatureHeader: "x-sig", prefix: "sha256=" })).ok, true);
  assert.equal((await verifyCourierAuth(hdr({ "x-sig": b64 }), body, { mode: "hmac", secret: "k", signatureHeader: "x-sig", encoding: "base64" })).ok, true);
  assert.equal((await verifyCourierAuth(hdr({ "x-sig": hex }), new TextEncoder().encode('{"awb":"A1","status":"y"}'), { mode: "hmac", secret: "k", signatureHeader: "x-sig" })).ok, false);
  assert.equal((await verifyCourierAuth(hdr({}), body, { mode: "hmac", secret: "k", signatureHeader: "x-sig" })).reason, "missing_signature");
});
test("courier payload extraction is generic and event keys are deterministic", async () => {
  const e = extractGeneric([{ current_status: "RTO_Delivered", awb: "A1", order_id: 55, courier_name: "X", current_timestamp: "2026-10-05 10:00:00" }]);
  assert.deepEqual([e.status, e.awb, e.orderRef, e.courier], ["RTO_Delivered", "A1", "55", "X"]);
  assert.equal(await eventKey("p", e), await eventKey("p", { ...e }));
  assert.notEqual(await eventKey("p", e), await eventKey("p", { ...e, timestamp: "2026-10-05 11:00:00" }));
  assert.notEqual(await eventKey("p", e), await eventKey("q", e));
});
