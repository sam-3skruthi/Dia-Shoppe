// ROLLBACK STUB for the deferred social inbox (social-webhook). Answers 503 to every request.
// No imports, no secrets, no database access: it cannot store anything and cannot be enabled by configuration.
// Deployed only by supabase/scripts/social-rollback-to-stub.ps1, and only if the containment release itself misbehaves.
Deno.serve(() => new Response("social inbox is disabled", { status: 503 }));
