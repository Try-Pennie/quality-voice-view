import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'

// Managers listen at speed — persist the chosen rate between calls.
const RATE_STORAGE_KEY = 'eavesly.playback-rate'
const RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
const SKIP_SECONDS = 10

function loadStoredRate(): number {
  try {
    const raw = localStorage.getItem(RATE_STORAGE_KEY)
    const parsed = raw ? parseFloat(raw) : NaN
    return RATE_OPTIONS.includes(parsed) ? parsed : 1
  } catch {
    return 1
  }
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'SUMMARY', 'A'].includes(el.tagName) || el.isContentEditable)
}

export function AudioPlayer({
  recordingUrl,
  enableKeyboard = true,
  onRetry,
}: {
  recordingUrl: string | null | undefined
  /** Space = play/pause, ←/→ = ±10s. Off when two players could coexist. */
  enableKeyboard?: boolean
  /** The alert owner reloads details to refresh private signed URLs without losing its draft. */
  onRetry?: () => void
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState<number>(loadStoredRate)
  const [failed, setFailed] = useState(false)

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(cause => {
        // Pausing or replacing a source while play is pending is not a media failure.
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (audioRef.current === audio && audio.isConnected) setFailed(true)
      })
    } else audio.pause()
  }

  const skip = (deltaSeconds: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + deltaSeconds), audio.duration)
    setCurrentTime(audio.currentTime)
  }

  const applyRate = (rate: number) => {
    setPlaybackRate(rate)
    if (audioRef.current) audioRef.current.playbackRate = rate
    try { localStorage.setItem(RATE_STORAGE_KEY, String(rate)) } catch {
      // Storage unavailable — rate still applies this session.
    }
  }

  useEffect(() => {
    if (!enableKeyboard || !recordingUrl) return
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isInteractiveTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); skip(-SKIP_SECONDS) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); skip(SKIP_SECONDS) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enableKeyboard, recordingUrl])

  if (!recordingUrl) return <div className="bg-pennie-beige/70 p-4 rounded-2xl text-center text-sm text-pennie-graphite/70">Recording not available</div>

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '–:––'
    return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
  }
  const hasDuration = Number.isFinite(duration) && duration > 0
  const skipClass = 'pennie-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-0.5 rounded-full border border-border text-pennie-graphite hover:bg-pennie-beige transition-colors'

  return <div>
    <audio
      ref={audioRef}
      src={recordingUrl}
      onLoadStart={() => { setFailed(false); setIsPlaying(false); setDuration(0); setCurrentTime(0) }}
      onError={() => { setFailed(true); setIsPlaying(false) }}
      onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
      onLoadedMetadata={() => {
        const audio = audioRef.current
        if (!audio) return
        setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
        audio.playbackRate = playbackRate
        setFailed(false)
      }}
      onPlay={() => { setIsPlaying(true); setFailed(false) }}
      onPause={() => setIsPlaying(false)}
      onEnded={() => setIsPlaying(false)}
    />
    {failed && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <p role="alert">Recording could not be played. Try loading it again.</p>
      <button type="button" onClick={() => {
        if (onRetry) onRetry()
        else audioRef.current?.load()
      }} className="pennie-focus-ring min-h-[44px] rounded-full border border-border px-3 font-semibold text-pennie-blue-deeper">Retry recording</button>
    </div>}
    <div className="grid grid-cols-[44px_44px_44px_minmax(0,1fr)_64px] items-center gap-x-1 sm:flex sm:gap-3">
      <button type="button" onClick={() => skip(-SKIP_SECONDS)} aria-label={`Back ${SKIP_SECONDS} seconds`} title={`Back ${SKIP_SECONDS}s (←)`} className={skipClass}>
        <RotateCcw className="w-4 h-4" aria-hidden="true" /><span className="text-[10px] sm:hidden">10s</span>
      </button>
      <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'} className="pennie-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center bg-pennie-navy text-pennie-white rounded-full hover:bg-pennie-navy/90 transition-colors">
        {isPlaying ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4 translate-x-[1px]" aria-hidden="true" />}
      </button>
      <button type="button" onClick={() => skip(SKIP_SECONDS)} aria-label={`Forward ${SKIP_SECONDS} seconds`} title={`Forward ${SKIP_SECONDS}s (→)`} className={skipClass}>
        <RotateCw className="w-4 h-4" aria-hidden="true" /><span className="text-[10px] sm:hidden">10s</span>
      </button>
      <input type="range" min={0} max={hasDuration ? duration : 0} value={currentTime} disabled={!hasDuration || failed}
        onChange={event => {
          const time = Number(event.target.value)
          setCurrentTime(time)
          if (audioRef.current) audioRef.current.currentTime = time
        }}
        aria-label="Seek" className="pennie-focus-ring order-last col-span-full h-11 w-full min-w-0 cursor-pointer touch-pan-x disabled:cursor-not-allowed accent-pennie-blue-dark sm:order-none sm:flex-1" />
      <span className="min-w-0 whitespace-nowrap text-right text-[11px] sm:text-sm text-muted-foreground tabular-nums">{formatTime(currentTime)} / {hasDuration ? formatTime(duration) : '–:––'}</span>
      <select value={playbackRate} onChange={event => applyRate(Number(event.target.value))} aria-label="Playback speed" className="pennie-focus-ring min-h-[44px] w-full sm:w-auto px-1 sm:px-3 border border-border rounded-full text-base sm:text-sm font-semibold bg-pennie-white text-pennie-graphite">
        {RATE_OPTIONS.map(rate => <option key={rate} value={rate}>{rate}x</option>)}
      </select>
    </div>
  </div>
}
