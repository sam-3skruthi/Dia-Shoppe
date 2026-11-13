/*
  Dia Shoppe brand monogram — recreated as SVG from the storefront signboard:
  a circle split into four quadrants by a crosshair, with a two-tone "DS"
  (D in brand blue, S in brand maroon) at the centre.

  If you later export the exact signboard logo as an image, drop it at
  /public/logos/dia-shoppe.png and swap this component for an <img>.
*/
export default function DiaShoppeLogo({ size = 40 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Dia Shoppe"
      className="shrink-0"
    >
      {/* Outer ring */}
      <circle cx="50" cy="50" r="46" fill="#E0F7FA" stroke="#0277BD" strokeWidth="4" />
      {/* Crosshair dividing the circle into four quadrants */}
      <line x1="50" y1="6"  x2="50" y2="94" stroke="#0277BD" strokeWidth="3" />
      <line x1="6"  y1="50" x2="94" y2="50" stroke="#0277BD" strokeWidth="3" />
      {/* Two-tone DS monogram */}
      <text
        x="30" y="64"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="46" fontWeight="700" fill="#0277BD"
        textAnchor="middle"
      >
        D
      </text>
      <text
        x="68" y="64"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontSize="46" fontWeight="700" fill="#054F7E"
        textAnchor="middle"
      >
        S
      </text>
    </svg>
  )
}
