/*
  Kept for compatibility: pages still render <PageBackground />, but the whole
  application now shares ONE background, painted on <body> in index.css
  (Mint Cream + soft aurora light). Rendering nothing here keeps every page on
  that same background instead of each page painting its own.
*/
export default function PageBackground() {
  return null
}
