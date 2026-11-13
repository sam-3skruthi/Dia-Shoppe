/*
  Organic wavy section divider (soft curve instead of a hard horizontal line),
  echoing the Veil reference. `fill` sets the colour of the incoming section;
  `flip` mirrors the curve vertically.
*/
export default function WavyDivider({ fill = '#E0F7FA', flip = false, className = '' }) {
  return (
    <div className={`w-full leading-[0] ${className}`} aria-hidden="true">
      <svg
        viewBox="0 0 1440 120"
        preserveAspectRatio="none"
        className={`w-full h-[60px] md:h-[90px] ${flip ? 'rotate-180' : ''}`}
      >
        <path
          fill={fill}
          d="M0,64 C240,128 480,0 720,32 C960,64 1200,128 1440,72 L1440,120 L0,120 Z"
        />
      </svg>
    </div>
  )
}
