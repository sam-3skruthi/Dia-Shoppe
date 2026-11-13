/*
  Whole-page backdrop: a soft teal gradient that sits FIXED behind all page
  content (`-z-10`). Every section that should reveal it is left transparent,
  so the teal feel persists in the gaps as you scroll. Shared across all pages
  to keep one consistent background.
*/
export default function PageBackground() {
  return (
    <div
      className="fixed inset-0 -z-10 bg-gradient-to-b from-secondary-50 via-white to-secondary-100/70"
      aria-hidden="true"
    />
  )
}
