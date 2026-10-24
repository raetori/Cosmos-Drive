import { useEffect, useRef } from 'react'

/** Slow-drifting, twinkling stars behind the app. Holds still when the OS asks for reduced motion. */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let stars: { x: number; y: number; r: number; a: number; tw: number; v: number }[] = []
    let frame = 0
    let w = 0
    let h = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round((w * h) / 5200)
      stars = Array.from({ length: count }, () => {
        const depth = Math.random()
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: 0.25 + depth * depth * 1.25,
          a: 0.25 + Math.random() * 0.75,
          tw: Math.random() * Math.PI * 2,
          v: 0.02 + depth * 0.09,
        }
      })
      draw(0)
    }

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        if (!still) {
          s.x -= s.v
          if (s.x < -2) s.x = w + 2
        }
        const alpha = still ? s.a : s.a * (0.65 + 0.35 * Math.sin(t / 900 + s.tw))
        ctx.globalAlpha = alpha
        ctx.fillStyle = s.r > 1.1 ? '#fff4dc' : '#dfe3ff'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }

    const loop = (t: number) => {
      draw(t)
      frame = requestAnimationFrame(loop)
    }

    resize()
    window.addEventListener('resize', resize)
    if (!still) frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div className="sky" aria-hidden>
      <div className="nebula" />
      <canvas ref={ref} />
    </div>
  )
}
