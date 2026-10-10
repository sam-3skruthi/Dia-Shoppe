// ROLLBACK STUB for the deferred social inbox (social-reply). Answers 503 to every request.
// No imports, no secrets, no database access, no Graph API call.
// Deployed only by supabase/scripts/social-rollback-to-stub.ps1, and only if the containment release itself misbehaves.
Deno.serve(() =>
  new Response(JSON.stringify({ error: "social inbox is disabled" }), { status: 503, headers: { "Content-Type": "application/json" } }));
