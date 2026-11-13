/*
  Official social destinations. LEAVE A URL EMPTY until it is confirmed:
  nothing links anywhere (and no icon is shown) for an empty or non-https value,
  so there is never a broken or invented link.

  Instagram confirmed by the owner. Add Facebook / X only when confirmed.
*/
export const social = {
  instagram: { url: 'https://www.instagram.com/hms_sandeep/', handle: 'hms_sandeep' },
  facebook: { url: '' },
  twitter: { url: '' },
}

/** Only well-formed https URLs count as a real destination. */
export const isLink = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/i.test(u.trim())
