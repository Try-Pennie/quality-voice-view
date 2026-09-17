import { useEffect, useRef, useState } from 'react'
import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react'
import { AudioSpectrum } from './AudioSpectrum'

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

interface Props {
  readonly recordingUrl: string | null | undefined
  /** Space = play/pause, ←/→ = ±10s. Off when two players could coexist. */
  readonly enableKeyboard?: boolean
  /** Reload details to refresh private signed URLs without losing the review draft. */
  readonly onRetry?: () => void
}

export function AudioPlayer(props: Props) {
  // A new URL owns a new element/graph; never keep the previous recording playing.
  return <RecordingPlayer key={props.recordingUrl} {...props} />
}

function RecordingPlayer({ recordingUrl, enableKeyboard = true, onRetry }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState<number>(loadStoredRate)
  const [failed, setFailed] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [audioOnly, setAudioOnly] = useState(() => typeof AudioContext === 'undefined')
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const graph = useRef<{ context: AudioContext; source: MediaElementAudioSourceNode } | null>(null)
  const metadataLoaded = useRef(false)
  const playRequested = useRef(false)
  const resumeNative = useRef(false)
  const resumeTime = useRef(0)

  const disposeGraph = () => {
    const current = graph.current
    graph.current = null
    if (!current) return
    current.source.disconnect()
    // Cleanup owns this promise; a closed context has no remaining playback to recover.
    current.context.close().catch(() => {})
  }
  useEffect(() => () => { audioRef.current?.pause(); disposeGraph() }, [])

  const play = (audio: HTMLAudioElement, automaticResume = false) => {
    audio.play().catch(cause => {
      if (audioRef.current !== audio || !audio.isConnected) return
      if (cause instanceof DOMException && (cause.name === 'AbortError' || (automaticResume && cause.name === 'NotAllowedError'))) return
      setFailed(true)
      setIsPlaying(false)
    })
  }
  const fallbackToNative = (audio: HTMLAudioElement) => {
    if (audioRef.current !== audio || !audio.isConnected) return
    resumeNative.current = playRequested.current
    resumeTime.current = audio.currentTime
    audio.pause()
    disposeGraph()
    setAnalyser(null)
    setAudioOnly(true)
  }
  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused) { playRequested.current = false; audio.pause(); return }
    playRequested.current = true
    if (!audioOnly) {
      try {
        if (!graph.current) {
          const context = new AudioContext()
          // Store ownership immediately so partial initialization is also cleaned up.
          try {
            const meter = context.createAnalyser()
            meter.fftSize = 2048
            meter.smoothingTimeConstant = 0.8
            const source = context.createMediaElementSource(audio)
            graph.current = { context, source }
            source.connect(context.destination)
            source.connect(meter)
            setAnalyser(meter)
          } catch {
            if (!graph.current) context.close().catch(() => {})
            throw new Error('Audio visualization unavailable')
          }
        }
        // Both native play and context resume start inside the user gesture (Safari included).
        graph.current.context.resume().catch(() => fallbackToNative(audio))
      } catch { fallbackToNative(audio); return }
    }
    play(audio)
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
  })

  if (!recordingUrl) return <div className="bg-pennie-beige/70 p-4 rounded-2xl text-center text-sm text-pennie-graphite/70">Recording not available</div>

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '–:––'
    return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
  }
  const hasDuration = Number.isFinite(duration) && duration > 0
  const skipClass = 'pennie-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-0.5 rounded-full border border-border text-pennie-graphite hover:bg-pennie-beige transition-[transform,background-color] duration-150 motion-safe:active:scale-[0.96]'

  return <div>
    <audio
      key={audioOnly ? 'native' : 'analysed'}
      ref={audioRef}
      src={recordingUrl}
      crossOrigin={audioOnly ? undefined : 'anonymous'}
      preload="metadata"
      onLoadStart={() => { metadataLoaded.current = false; setFailed(false); setBuffering(false); setIsPlaying(false); setDuration(0); setCurrentTime(0) }}
      onError={event => {
        // CORS can forbid analysis while ordinary <audio> playback is still allowed.
        // A fresh native element is essential: Web Audio permanently routes its source element.
        if (!audioOnly && !metadataLoaded.current) { fallbackToNative(event.currentTarget); return }
        setFailed(true); setIsPlaying(false); setBuffering(false)
      }}
      onWaiting={() => setBuffering(true)}
      onPlaying={() => setBuffering(false)}
      onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
      onLoadedMetadata={() => {
        const audio = audioRef.current
        if (!audio) return
        metadataLoaded.current = true
        setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
        audio.playbackRate = playbackRate
        if (resumeTime.current && Number.isFinite(audio.duration)) audio.currentTime = Math.min(resumeTime.current, audio.duration)
        resumeTime.current = 0
        setFailed(false)
        if (resumeNative.current) { resumeNative.current = false; play(audio, true) }
      }}
      onPlay={() => { playRequested.current = true; setIsPlaying(true); setFailed(false) }}
      onPause={() => { playRequested.current = false; setIsPlaying(false); setBuffering(false) }}
      onEnded={() => { playRequested.current = false; setIsPlaying(false); setBuffering(false) }}
    />
    {failed && <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <p role="alert">Recording could not be played. Try loading it again.</p>
      <button type="button" onClick={() => {
        if (onRetry) onRetry()
        else audioRef.current?.load()
      }} className="pennie-focus-ring min-h-[44px] rounded-full border border-border px-3 font-semibold text-pennie-blue-deeper">Retry recording</button>
    </div>}
    <div className="flex h-6 items-center gap-3" title={audioOnly ? 'This recording plays without live visualization.' : 'Live frequency levels of the sound playing now, not a full-recording waveform.'}>
      <span className="w-[76px] shrink-0 text-[10px] font-semibold tracking-wide text-pennie-graphite/70">{failed ? 'Unavailable' : buffering ? 'Buffering…' : audioOnly ? 'Audio only' : isPlaying ? 'Live audio' : currentTime > 0 ? 'Paused' : 'Ready to play'}</span>
      {audioOnly ? <span aria-hidden="true" className="h-px flex-1 bg-border" /> : <AudioSpectrum analyser={analyser} active={isPlaying && !buffering && !failed} />}
    </div>
    <div className="grid grid-cols-[44px_44px_44px_minmax(0,1fr)_64px] items-center gap-x-1 sm:flex sm:gap-3">
      <button type="button" onClick={() => skip(-SKIP_SECONDS)} aria-label={`Back ${SKIP_SECONDS} seconds`} title={`Back ${SKIP_SECONDS}s (←)`} className={skipClass}>
        <RotateCcw className="w-4 h-4" aria-hidden="true" /><span className="text-[10px] sm:hidden">10s</span>
      </button>
      <button type="button" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'} className="pennie-focus-ring min-h-[44px] min-w-[44px] inline-flex items-center justify-center bg-pennie-navy text-pennie-white rounded-full hover:bg-pennie-navy/90 transition-[transform,background-color] duration-150 motion-safe:active:scale-[0.96]">
        {isPlaying ? <Pause className="w-4 h-4" aria-hidden="true" /> : <Play className="w-4 h-4 translate-x-[1px]" aria-hidden="true" />}
      </button>
      <button type="button" onClick={() => skip(SKIP_SECONDS)} aria-label={`Forward ${SKIP_SECONDS} seconds`} title={`Forward ${SKIP_SECONDS}s (→)`} className={skipClass}>
        <RotateCw className="w-4 h-4" aria-hidden="true" /><span className="text-[10px] sm:hidden">10s</span>
      </button>
      <div className="relative order-last col-span-full h-11 w-full min-w-0 sm:order-none sm:flex-1">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-1.5 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-pennie-navy/10">
          <div className="h-full rounded-full bg-pennie-blue-deeper" style={{ width: `${hasDuration ? Math.min(100, currentTime / duration * 100) : 0}%` }} />
        </div>
        <input type="range" min={0} max={hasDuration ? duration : 0} value={currentTime} disabled={!hasDuration || failed}
          onChange={event => {
            const time = Number(event.target.value)
            setCurrentTime(time)
            if (audioRef.current) audioRef.current.currentTime = time
          }}
          aria-label="Seek" aria-valuetext={`${formatTime(currentTime)} of ${hasDuration ? formatTime(duration) : 'unknown duration'}`}
          className="recording-seek pennie-focus-ring absolute inset-0 h-full w-full cursor-pointer touch-pan-x rounded-full disabled:cursor-not-allowed" />
      </div>
      <span className="min-w-0 whitespace-nowrap text-right text-[11px] sm:text-sm text-muted-foreground tabular-nums">{formatTime(currentTime)} / {hasDuration ? formatTime(duration) : '–:––'}</span>
      <select value={playbackRate} onChange={event => applyRate(Number(event.target.value))} aria-label="Playback speed" className="pennie-focus-ring min-h-[44px] w-full sm:w-auto px-1 sm:px-3 border border-border rounded-full text-base sm:text-sm font-semibold bg-pennie-white text-pennie-graphite">
        {RATE_OPTIONS.map(rate => <option key={rate} value={rate}>{rate}x</option>)}
      </select>
    </div>
  </div>
}
