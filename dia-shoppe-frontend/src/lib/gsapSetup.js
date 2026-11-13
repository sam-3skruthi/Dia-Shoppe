/* One place that registers GSAP plugins, so every section shares the same
   ScrollTrigger instance (and Vite emits a single shared chunk for it). */
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger)

export { gsap, ScrollTrigger }
