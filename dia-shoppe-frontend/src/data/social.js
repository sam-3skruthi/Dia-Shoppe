/*
  Official social destinations. LEAVE A URL EMPTY until it is confirmed:
  nothing links anywhere (and no icon is shown) for an empty or non-https value,
  so there is never a broken or invented link.

  TODO(owner): supply the official Instagram profile URL (https://…) and, if
  wanted, the handle; add Facebook / X only when confirmed.
*/
export const social = {
  instagram: { url: '', handle: '' },
  facebook: { url: '' },
  twitter: { url: '' },
}

/** Only well-formed https URLs count as a real destination. */
export const isLink = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u.trim())
