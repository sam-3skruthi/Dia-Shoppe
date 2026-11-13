import { supabase } from './supabase'

/*
  Online payment flow (UPI / card / netbanking) via Razorpay Checkout.

  1. create-razorpay-order Edge Function → makes a Razorpay order for our
     internal order (amount is derived server-side from the DB, never trusted
     from the browser)
  2. Razorpay's modal collects the payment
  3. verify-payment Edge Function → checks the signature server-side, marks
     the order 'paid' and decrements stock

  Resolves to { success } | { cancelled } | { error }.
*/

const loadRazorpayScript = () =>
  new Promise((resolve) => {
    if (window.Razorpay) return resolve(true)
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(true)
    s.onerror = () => resolve(false)
    document.body.appendChild(s)
  })

export async function payForOrder({ orderId, email, name, phone }) {
  const scriptOk = await loadRazorpayScript()
  if (!scriptOk) return { error: 'Could not load the payment window. Check your connection and try again.' }

  const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
    body: { orderId },
  })
  if (error) return { error: error.message }
  if (data?.error) return { error: data.error }

  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      order_id: data.razorpayOrderId,
      name: 'Dia Shoppe',
      description: `Order #${orderId}`,
      prefill: { name, email, contact: phone },
      theme: { color: '#0277BD' },
      handler: async (resp) => {
        const { data: v, error: vError } = await supabase.functions.invoke('verify-payment', {
          body: {
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature,
            internal_order_id: orderId,
          },
        })
        if (vError) resolve({ error: vError.message })
        else if (!v?.success) resolve({ error: v?.error || 'Payment verification failed' })
        else resolve({ success: true })
      },
      modal: {
        ondismiss: () => resolve({ cancelled: true }),
      },
    })
    rzp.open()
  })
}
