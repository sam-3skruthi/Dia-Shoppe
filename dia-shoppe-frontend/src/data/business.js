/*
  Business details used by the legal pages (Privacy, Terms, Refunds) and the
  footer.

  ⚠️ FILL THESE IN before going live. Razorpay's live-mode activation and Meta's
  business verification both check that the details on your website match the
  ones you registered with them — mismatches are a common rejection reason.

  Anything left as a TODO placeholder is rendered in the page as an obvious
  "[to be filled]" marker rather than a silent blank, so it can't slip through.
*/

export const business = {
  legalName: 'Dia Shoppe Surgical Distributors',
  tradingName: 'Dia Shoppe',

  // TODO: your full registered address
  address: 'TODO: Registered address, City, State, PIN',

  // TODO: leave as null if not registered for GST
  gstin: null,

  email: 'support@diashoppe.in',

  // TODO: replace with the real business number (the current one is a placeholder)
  phone: 'TODO: +91 XXXXX XXXXX',

  website: 'https://www.diashoppe.com',

  // Policy values — change these and every legal page updates with them
  returnWindowDays: 7,
  refundProcessingDays: '5–7 working days',
  dispatchTime: '1–2 working days',
  deliveryTime: '3–7 working days',
  freeShippingOver: 2000,
  shippingFee: 99,

  lastUpdated: 'August 2026',
}

/** True when a field still holds its placeholder, so pages can flag it. */
export const isTodo = (v) => typeof v === 'string' && v.startsWith('TODO')
