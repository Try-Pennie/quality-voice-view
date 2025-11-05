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

      <div className="flex items-center gap-4">
        <button
          onClick={togglePlay}
          className="bg-primary text-primary-foreground p-3 rounded-full hover:bg-primary/90"
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
          className="flex-1"
        />

        <span className="text-sm text-muted-foreground min-w-[80px] text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <select
          value={playbackRate}
          onChange={(e) => {
            const rate = parseFloat(e.target.value)
            if (audioRef.current) audioRef.current.playbackRate = rate
            setPlaybackRate(rate)
          }}
          className="px-3 py-1 border border-input rounded text-sm bg-background"
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
