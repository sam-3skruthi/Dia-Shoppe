// Dia Shoppe — creates a Razorpay order for an existing internal order.
// Called by the frontend right before opening the Razorpay checkout modal.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID")!;
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET")!;
// overridable so DEV can point at a mock instead of the real Razorpay API
const RAZORPAY_API_BASE = Deno.env.get("RAZORPAY_API_BASE") || "https://api.razorpay.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // Identify the calling user from their JWT (never trust a client-supplied user id)
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orderId } = await req.json();

    // Re-derive the amount server-side from the DB — never trust a client-supplied amount
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, user_id, status, total_amount, razorpay_order_id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (order.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not your order" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // A cancelled/expired/paid order must never get a payment window
    if (order.status !== "pending") {
      return new Response(JSON.stringify({ error: "This order is no longer awaiting payment" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const amountPaise = Math.round(Number(order.total_amount) * 100);

    // Retry after a cancelled/failed attempt: reuse the same Razorpay order
    if (order.razorpay_order_id) {
      return new Response(
        JSON.stringify({
          razorpayOrderId: order.razorpay_order_id,
          amount: amountPaise,
          currency: "INR",
          keyId: RAZORPAY_KEY_ID,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const auth = btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`);

    const response = await fetch(`${RAZORPAY_API_BASE}/v1/orders`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt: `order_rcpt_${order.id}`,
        notes: { internal_order_id: String(order.id) },
      }),
    });

    const razorpayOrder = await response.json();
    if (!response.ok) {
      return new Response(JSON.stringify({ error: razorpayOrder.error?.description || "Razorpay error" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Save the Razorpay order id so verify-payment can match it back
    await supabase
      .from("orders")
      .update({ razorpay_order_id: razorpayOrder.id })
      .eq("id", order.id);

    return new Response(
      JSON.stringify({
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        keyId: RAZORPAY_KEY_ID,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
