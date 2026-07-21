import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'

// Managers listen at speed — persist the chosen rate so "always 1.5x"
// survives moving between alerts and page loads.
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
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'A' ||
    el.isContentEditable
  )
}

export function AudioPlayer({
  recordingUrl,
  enableKeyboard = true,
}: {
  recordingUrl: string | null | undefined
  /** Space = play/pause, ←/→ = ±10s. Off when two players could coexist. */
  enableKeyboard?: boolean
}) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState<number>(loadStoredRate)

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play()
    } else {
      audio.pause()
    }
  }

  const skip = (deltaSeconds: number) => {
    const audio = audioRef.current
    if (!audio) return
    const max = Number.isFinite(audio.duration) ? audio.duration : Infinity
    audio.currentTime = Math.min(
      Math.max(0, audio.currentTime + deltaSeconds),
      max,
    )
  }

  const applyRate = (rate: number) => {
    setPlaybackRate(rate)
    if (audioRef.current) audioRef.current.playbackRate = rate
    try {
      localStorage.setItem(RATE_STORAGE_KEY, String(rate))
    } catch {
      // localStorage unavailable (private mode) — rate still applies this session.
    }
  }

  // Keyboard transport. Guarded against interactive targets so typing in the
  // review form or activating a focused button never double-triggers playback.
  useEffect(() => {
    if (!enableKeyboard || !recordingUrl) return
    const handler = (e: KeyboardEvent) => {
      if (isInteractiveTarget(e.target)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        skip(-SKIP_SECONDS)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        skip(SKIP_SECONDS)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [enableKeyboard, recordingUrl])

  if (!recordingUrl) {
    return (
      <div className="bg-pennie-beige/70 p-4 rounded-2xl text-center text-sm text-pennie-graphite/70">
        Recording not available
      </div>
    )
  }

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '–:––'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const hasDuration = Number.isFinite(duration) && duration > 0

  return (
    <div className="space-y-4">
      <audio
        ref={audioRef}
        src={recordingUrl}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => {
          const audio = audioRef.current
          if (!audio) return
          const d = audio.duration
          setDuration(Number.isFinite(d) && d ? d : 0)
          // Re-apply the persisted rate — a fresh src resets playbackRate to 1.
          audio.playbackRate = playbackRate
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          aria-label={`Back ${SKIP_SECONDS} seconds`}
          title={`Back ${SKIP_SECONDS}s (←)`}
          className="pennie-focus-ring hidden sm:inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border text-pennie-graphite hover:bg-pennie-beige transition-colors"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          className="pennie-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center bg-pennie-navy text-pennie-white rounded-full hover:bg-pennie-navy/90 transition-colors"
        >
          {isPlaying ? (
            <Pause className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Play className="w-4 h-4 translate-x-[1px]" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          aria-label={`Forward ${SKIP_SECONDS} seconds`}
          title={`Forward ${SKIP_SECONDS}s (→)`}
          className="pennie-focus-ring hidden sm:inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border text-pennie-graphite hover:bg-pennie-beige transition-colors"
        >
          <RotateCw className="w-4 h-4" aria-hidden="true" />
        </button>

        <input
          type="range"
          min={0}
          max={hasDuration ? duration : 0}
          value={currentTime}
          disabled={!hasDuration}
          onChange={(e) => {
            const newTime = parseFloat(e.target.value)
            if (audioRef.current) audioRef.current.currentTime = newTime
          }}
          aria-label="Seek"
          className="flex-1 h-2 cursor-pointer touch-pan-x disabled:cursor-not-allowed accent-pennie-blue-dark"
        />

        <span className="text-sm text-muted-foreground min-w-[72px] sm:min-w-[80px] text-right tabular-nums">
          {formatTime(currentTime)} / {hasDuration ? formatTime(duration) : '–:––'}
        </span>

        <select
          value={playbackRate}
          onChange={(e) => applyRate(parseFloat(e.target.value))}
          aria-label="Playback speed"
          className="pennie-focus-ring min-h-[44px] sm:min-h-[40px] pl-3 pr-2 py-2 border border-border rounded-full text-base sm:text-sm font-semibold bg-pennie-white text-pennie-graphite"
        >
          {RATE_OPTIONS.map(rate => (
            <option key={rate} value={rate}>
              {rate}x
            </option>
          ))}
        </select>
      </div>

      {/* Mobile keeps skip reachable without crowding the transport row. */}
      <div className="flex sm:hidden gap-2">
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          className="pennie-focus-ring flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
          {SKIP_SECONDS}s
        </button>
        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          className="pennie-focus-ring flex-1 min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-full border border-border text-sm font-semibold text-pennie-graphite hover:bg-pennie-beige transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
          {SKIP_SECONDS}s
        </button>
      </div>
    </div>
  )
}
