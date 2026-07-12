interface PlaybackControlsProps {
  isPlaying: boolean;
  isLoading: boolean;
  playbackRate: number;
  onPlay(): void;
  onPause(): void;
  onStop(): void;
  onSkip(delta: number): void;
  onSpeedChange(rate: number): void;
}

/** Transport controls for local audiobook playback. */
export function PlaybackControls(props: PlaybackControlsProps) {
  const { isPlaying, isLoading, playbackRate, onPlay, onPause, onStop, onSkip, onSpeedChange } = props;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[1.5rem] bg-ink px-5 py-4 text-white shadow-panel">
      <button className="rounded-full border border-white/30 px-4 py-2" onClick={() => onSkip(-1)} type="button">
        Back
      </button>
      {isPlaying ? (
        <button className="rounded-full bg-flax px-5 py-2 font-semibold text-ink" onClick={onPause} type="button">
          Pause
        </button>
      ) : (
        <button className="rounded-full bg-flax px-5 py-2 font-semibold text-ink" onClick={onPlay} type="button" disabled={isLoading}>
          {isLoading ? "Buffering" : "Play"}
        </button>
      )}
      <button className="rounded-full border border-white/30 px-4 py-2" onClick={onStop} type="button">
        Stop
      </button>
      <button className="rounded-full border border-white/30 px-4 py-2" onClick={() => onSkip(1)} type="button">
        Forward
      </button>
      <label className="ml-auto flex items-center gap-2 text-sm">
        Speed
        <select
          className="rounded-full bg-white/10 px-3 py-2 text-white outline-none"
          value={playbackRate}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
        >
          {[0.75, 1, 1.25, 1.5, 1.75].map((rate) => (
            <option key={rate} value={rate} className="text-ink">
              {rate.toFixed(2)}x
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
