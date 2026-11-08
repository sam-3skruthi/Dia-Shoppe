import dMul from '../../assets/dia/d-mul.webp'
import dAdd from '../../assets/dia/d-add.webp'
import sMul from '../../assets/dia/s-mul.webp'
import sAdd from '../../assets/dia/s-add.webp'
import dMulM from '../../assets/dia/d-mul-m.webp'
import dAddM from '../../assets/dia/d-add-m.webp'
import sMulM from '../../assets/dia/s-mul-m.webp'
import sAddM from '../../assets/dia/s-add-m.webp'

/*
  The approved glass D and S, floating faintly behind a section. Same maps as
  the loader (glass multiplies the surface, highlights add light), as plain
  images: no WebGL on the page. Slow CSS float + scroll parallax (data-parallax,
  driven by useReveal). The parent section must be `relative isolate` with an
  opaque aurora background so the blend modes have something to blend with.

  Each layer carries its own blend mode on the OUTERMOST element: a blend inside
  a transformed ancestor would blend against nothing.
*/
const SIZES = '(max-width: 768px) 70vw, 640px'

function Layer({ kind, small, full, className, parallax, floatClass }) {
  const mul = kind === 'mul'
  return (
    <div
      data-parallax={parallax}
      className={`absolute ${className}`}
      style={{ mixBlendMode: mul ? 'multiply' : 'screen' }}
    >
      <div className={floatClass}>
        <img
          src={small}
          srcSet={`${small} 1024w, ${full} 1448w`}
          sizes={SIZES}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="block h-auto w-full select-none"
          style={mul ? undefined : { filter: 'brightness(0.17)' }}
        />
      </div>
    </div>
  )
}

export default function DsBackdrop() {
  const dPos = 'left-[-18%] top-[-2%] w-[78vw] max-w-[640px] sm:left-[-6%] sm:w-[52vw] opacity-[0.4] sm:opacity-[0.46]'
  const sPos = 'right-[-22%] bottom-[-3%] w-[82vw] max-w-[680px] sm:right-[-8%] sm:w-[54vw] opacity-[0.4] sm:opacity-[0.46]'
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden select-none">
      <Layer kind="mul" small={dMulM} full={dMul} className={dPos} parallax="0.16" floatClass="dia-float-a" />
      <Layer kind="add" small={dAddM} full={dAdd} className={dPos} parallax="0.16" floatClass="dia-float-a" />
      <Layer kind="mul" small={sMulM} full={sMul} className={sPos} parallax="0.24" floatClass="dia-float-b" />
      <Layer kind="add" small={sAddM} full={sAdd} className={sPos} parallax="0.24" floatClass="dia-float-b" />
    </div>
  )
}
