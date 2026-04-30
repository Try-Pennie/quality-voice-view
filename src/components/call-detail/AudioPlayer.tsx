import { useState, useRef } from 'react'

export function AudioPlayer({ recordingUrl }: { recordingUrl: string | null | undefined }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackRate, setPlaybackRate] = useState(1)

  if (!recordingUrl) {
    return (
      <div className="bg-muted p-4 rounded text-center text-muted-foreground">
        Recording not available
      </div>
    )
  }

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause()
      } else {
        audioRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="space-y-4">
      <audio
        ref={audioRef}
        src={recordingUrl}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setIsPlaying(false)}
      />

      <div className="flex items-center gap-3 sm:gap-4">
        <button
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center bg-primary text-primary-foreground rounded-full hover:bg-primary/90"
        >
          {isPlaying ? '⏸' : '▶️'}
        </button>

        <input
          type="range"
          min={0}
          max={duration || 0}
          value={currentTime}
          onChange={(e) => {
            const newTime = parseFloat(e.target.value)
            if (audioRef.current) audioRef.current.currentTime = newTime
          }}
          aria-label="Seek"
          className="flex-1 h-2 cursor-pointer touch-pan-x"
        />

        <span className="text-sm text-muted-foreground min-w-[72px] sm:min-w-[80px] text-right tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <select
          value={playbackRate}
          onChange={(e) => {
            const rate = parseFloat(e.target.value)
            if (audioRef.current) audioRef.current.playbackRate = rate
            setPlaybackRate(rate)
          }}
          aria-label="Playback speed"
          className="min-h-[44px] px-3 py-2 border border-input rounded-md text-base sm:text-sm bg-background"
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </div>
    </div>
  )
}
