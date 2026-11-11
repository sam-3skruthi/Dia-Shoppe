import dMul from '../../assets/dia/d-mul.webp'
import dAdd from '../../assets/dia/d-add.webp'
import sMul from '../../assets/dia/s-mul.webp'
import sAdd from '../../assets/dia/s-add.webp'
import dMulM from '../../assets/dia/d-mul-m.webp'
import dAddM from '../../assets/dia/d-add-m.webp'
import sMulM from '../../assets/dia/s-mul-m.webp'
import sAddM from '../../assets/dia/s-add-m.webp'

/*
  The approved glass D and S as ONE compact, STATIC pair (D above-left, S
  below-right, overlapping like the loader's final frame). No float, no
  rotation, no parallax. Same maps as the loader: glass multiplies the page
  background and highlights add light, so the original sculptures are shown
  as they are, over the site's one background.

  Blend modes and opacity sit on each <img>, and nothing between them and the
  page creates a stacking context, so they blend with the real background
  instead of with an empty layer.
*/
const SIZES = '(max-width: 768px) 60vw, 520px'

function Glass({ mul, mulM, add, addM, className, opacity }) {
  return (
    <div className={`absolute ${className}`} style={{ aspectRatio: '4 / 3' }}>
      <img
        src={mulM} srcSet={`${mulM} 1024w, ${mul} 1448w`} sizes={SIZES}
        alt="" loading="lazy" decoding="async" draggable={false}
        className="absolute inset-0 h-full w-full select-none"
        style={{ mixBlendMode: 'multiply', opacity }}
      />
      <img
        src={addM} srcSet={`${addM} 1024w, ${add} 1448w`} sizes={SIZES}
        alt="" loading="lazy" decoding="async" draggable={false}
        className="absolute inset-0 h-full w-full select-none"
        style={{ mixBlendMode: 'screen', filter: 'brightness(0.17)', opacity }}
      />
    </div>
  )
}

export default function DsPair({ className = '', opacity = 0.6 }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none select-none ${className}`}>
      <div className="relative w-full" style={{ aspectRatio: '1.25' }}>
        <Glass mul={dMul} mulM={dMulM} add={dAdd} addM={dAddM} className="left-0 top-0 w-[68%]" opacity={opacity} />
        <Glass mul={sMul} mulM={sMulM} add={sAdd} addM={sAddM} className="bottom-0 right-0 w-[68%]" opacity={opacity} />
      </div>
    </div>
  )
}
