/*
  Full-page fixed backdrop matching the Home "Testimonials" section:
  a navy gradient (ink-950 → primary-950 → ink-950) with soft teal glows.
  Used on Cart, Checkout and Order Confirmation.
*/
export default function PageBackdrop() {
  return (
    <div
      className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b from-ink-950 via-primary-950 to-ink-950"
      aria-hidden="true"
    >
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-secondary-500/20 rounded-full blur-3xl animate-blob-slow" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary-500/15 rounded-full blur-3xl animate-blob-slower" />
    </div>
  )
}
