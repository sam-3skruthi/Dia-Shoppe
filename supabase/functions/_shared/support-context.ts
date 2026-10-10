import type { SupportContext } from "./ai/types.ts";

// The ONLY place customer-facing AI context is assembled. Rules:
//  - explicit column lists (never select *), so a new sensitive column can never leak by accident
//  - products: name/brand/category/price/in-stock only. Cost lives in product_costs and is never read here.
//  - orders: only those linked to THIS sender (their WhatsApp number, or their own profile). No address, email, payment id.
//  - nothing is derived from the customer's message: they cannot widen what is loaded.
// deno-lint-ignore no-explicit-any
type Sb = any;

export async function buildSupportContext(sb: Sb, phoneE164: string, env: (k: string) => string | undefined): Promise<SupportContext> {
  const last10 = phoneE164.slice(-10);
  const { data: profile } = await sb.from("user_profiles").select("id, first_name").like("phone", `%${last10}`).limit(1).maybeSingle();

  const ordersQ = sb.from("orders")
    .select("id, status, total_amount, created_at, courier, tracking_number, order_items(quantity, products(name))")
    .order("created_at", { ascending: false }).limit(5);
  const [prods, orders, settings] = await Promise.all([
    sb.from("products").select("name, brand, price, stock_qty, categories(name)").eq("is_active", true).limit(150),
    profile?.id ? ordersQ.or(`shipping_phone.like.%${last10},user_id.eq.${profile.id}`) : ordersQ.like("shipping_phone", `%${last10}`),
    sb.from("site_settings").select("key, value").in("key", ["message_settings", "support_policies"]),
  ]);
  // deno-lint-ignore no-explicit-any
  const byKey: Record<string, any> = Object.fromEntries((settings.data ?? []).map((r: any) => [r.key, r.value]));
  const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

  return {
    customer: { known: !!profile || (orders.data ?? []).length > 0, firstName: profile?.first_name || undefined },
    store: {
      name: "Dia Shoppe", website: env("STORE_URL") || undefined, phones: list(env("STORE_PHONES")), emails: list(env("STORE_EMAILS")),
      policies: String(byKey.support_policies?.text ?? "").slice(0, 3000),
    },
    // deno-lint-ignore no-explicit-any
    catalog: (prods.data ?? []).map((p: any) => ({
      name: String(p.name), brand: String(p.brand ?? ""), category: String(p.categories?.name ?? "General"), price: Number(p.price), inStock: Number(p.stock_qty) > 0,
    })),
    // deno-lint-ignore no-explicit-any
    orders: (orders.data ?? []).map((o: any) => ({
      id: Number(o.id), status: String(o.status), total: Number(o.total_amount), placedOn: String(o.created_at).slice(0, 10),
      // deno-lint-ignore no-explicit-any
      items: (o.order_items ?? []).map((i: any) => `${i.products?.name ?? "item"} x${i.quantity}`),
      courier: o.courier || undefined, tracking: o.tracking_number || undefined,
    })),
    ownerInstructions: byKey.message_settings?.ai_instructions || undefined,
  };
}
