import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'

/*
  Scroll-linked 3D container, adapted from the supplied ContainerScroll.
  ADAPTED: the supplied dark device-like card frame is gone (children bring
  their own frame, here a phone); progress now completes when the block reaches
  the middle of the screen, so it is flat when you are looking at it; motion is
  gentler; and prefers-reduced-motion disables it.
*/
export function ContainerScroll({ titleComponent, children, cardClassName = '' }) {
  const ref = useRef(null)
  const reduce = useReducedMotion()
  const [isMobile, setIsMobile] = useState(false)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] })

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const rotate = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [16, 0])
  const scale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : isMobile ? [0.86, 1] : [0.94, 1])
  const translate = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, 0])

  return (
    <div ref={ref} className="relative flex items-center justify-center px-2 py-10 md:px-10 md:py-16">
      <div className="relative w-full" style={{ perspective: '1000px' }}>
        <Header translate={translate} titleComponent={titleComponent} />
        <Card rotate={rotate} translate={translate} scale={scale} className={cardClassName}>
          {children}
        </Card>
      </div>
    </div>
  )
}

export function Header({ translate, titleComponent }) {
  return (
    <motion.div style={{ translateY: translate }} className="mx-auto max-w-3xl text-center">
      {titleComponent}
    </motion.div>
  )
}

export function Card({ rotate, scale, className = '', children }) {
  return (
    <motion.div style={{ rotateX: rotate, scale }} className={`mt-12 ${className}`}>
      {children}
    </motion.div>
  )
}
