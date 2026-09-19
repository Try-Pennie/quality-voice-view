import { useEffect, useRef } from 'react'

/** Current sound, not a full-recording waveform. Never downloads or decodes a recording. */
export function AudioSpectrum({ analyser, active }: { readonly analyser: AnalyserNode | null; readonly active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const bins = new Uint8Array(analyser?.frequencyBinCount ?? 0)
    let frame = 0, previous = 0, width = 0, height = 0

    const paint = (live: boolean) => {
      context.clearRect(0, 0, width, height)
      if (live && analyser) analyser.getByteFrequencyData(bins)
      const count = Math.max(1, Math.floor(width / 6))
      const nyquist = analyser ? analyser.context.sampleRate / 2 : 1
      // Spread the telephone speech band across the full width, not the quiet 4–8kHz tail.
      const upperFrequency = Math.min(4000, nyquist)
      for (let i = 0; i < count; i++) {
        // Log-spaced speech bands; every bar comes from the actual current audio.
        const start = Math.floor(80 * (upperFrequency / 80) ** (i / count) / nyquist * bins.length)
        const end = Math.min(bins.length, Math.max(start + 1, Math.ceil(80 * (upperFrequency / 80) ** ((i + 1) / count) / nyquist * bins.length)))
        let level = 0
        if (live) for (let bin = start; bin < end; bin++) level = Math.max(level, bins[bin])
        const barHeight = Math.max(2, level / 255 * height)
        context.beginPath()
        context.roundRect(i * width / count, (height - barHeight) / 2, 3, barHeight, 1.5)
        context.fill()
      }
    }
    const tick = (time: number) => {
      if (time - previous >= 1000 / 30) { paint(true); previous = time }
      frame = requestAnimationFrame(tick)
    }
    const sync = () => {
      cancelAnimationFrame(frame)
      paint(false)
      if (active && analyser && !reducedMotion.matches && !document.hidden) frame = requestAnimationFrame(tick)
    }
    const resize = () => {
      const size = canvas.getBoundingClientRect(), scale = Math.min(window.devicePixelRatio || 1, 2)
      width = size.width; height = size.height
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.fillStyle = getComputedStyle(canvas).color
      sync()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    reducedMotion.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    resize()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      reducedMotion.removeEventListener('change', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [analyser, active])

  return <canvas ref={canvasRef} role="img" aria-label="Live audio frequencies, not a recording timeline"
    className="h-6 min-w-0 flex-1 text-pennie-blue-deeper" />
}
