import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function formatClipTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function minGapSeconds(duration: number): number {
  if (duration <= 0) return 0.05;
  if (duration >= 2) return 1;
  return Math.max(0.05, duration * 0.2);
}

/** Position in trim as 0..1 (relative to clip length). */
function fractionIntoClip(t: number, start: number, end: number): number {
  const len = end - start;
  if (len <= 0) return 0;
  return (t - start) / len;
}

const END_EPS = 1 / 30;

type Props = {
  file: File | null;
  startTime: number;
  endTime: number;
  onStartChange: (t: number) => void;
  onEndChange: (t: number) => void;
  onDurationLoaded: (duration: number) => void;
  onLoadError?: (msg: string) => void;
};

export function TrimTimeline({
  file,
  startTime,
  endTime,
  onStartChange,
  onEndChange,
  onDurationLoaded,
  onLoadError,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(startTime);
  const endRef = useRef(endTime);
  startRef.current = startTime;
  endRef.current = endTime;

  const videoUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const [duration, setDuration] = useState(0);
  const [, setTick] = useState(0);
  const [isDragging, setIsDragging] = useState<"start" | "end" | null>(null);
  const lastDragTypeRef = useRef<"start" | "end" | null>(null);
  const [scrubber, setScrubber] = useState<{ visible: boolean; pct: number }>({ visible: false, pct: 0 });

  useEffect(() => {
    if (!videoUrl) {
      setDuration(0);
      return;
    }
    return () => {
      URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const handlePlaybackTick = useCallback(() => {
    const v = videoRef.current;
    if (!v || duration <= 0) return;
    if (v.seeking) return;
    const st = startRef.current;
    const en = endRef.current;
    const len = en - st;
    if (len <= 0) return;

    if (v.currentTime < st) {
      v.currentTime = st;
      setTick((t) => t + 1);
      return;
    }

    if (v.currentTime >= en - END_EPS) {
      if (!v.paused) {
        v.currentTime = st;
        setTick((t) => t + 1);
      } else {
        if (v.currentTime > en) {
          v.currentTime = en;
          setTick((t) => t + 1);
        }
      }
    }
  }, [duration]);

  const onTimeUpdate = useCallback(() => {
    handlePlaybackTick();
    setTick((t) => t + 1);
  }, [handlePlaybackTick]);

  const getTimeFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track || duration <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    return pct * duration;
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, x / rect.width));
      const t = pct * duration;
      const g = minGapSeconds(duration);
      const vid = videoRef.current;
      if (isDragging === "start") {
        const nt = Math.min(t, endRef.current - g);
        const val = Math.max(0, nt);
        startRef.current = val;
        onStartChange(val);
        if (vid) vid.currentTime = val;
      } else {
        const nt = Math.max(t, startRef.current + g);
        const val = Math.min(duration, nt);
        endRef.current = val;
        onEndChange(val);
        if (vid) vid.currentTime = val;
      }
      setTick((x0) => x0 + 1);
    };
    const onUp = () => setIsDragging(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, duration, onStartChange, onEndChange]);

  useEffect(() => {
    if (isDragging || duration <= 0) return;
    const v = videoRef.current;
    if (!v) return;
    startRef.current = startTime;
    endRef.current = endTime;

    const dragWasStart = lastDragTypeRef.current === "start";
    lastDragTypeRef.current = null;

    // After releasing the start handle while paused, always snap to the new start
    // so play always begins at the correct position.
    if (dragWasStart && v.paused && v.currentTime !== startTime) {
      v.currentTime = startTime;
      setTick((x) => x + 1);
      return;
    }

    if (v.currentTime < startTime) {
      v.currentTime = startTime;
      setTick((x) => x + 1);
    } else if (v.currentTime > endTime) {
      v.currentTime = endTime;
      setTick((x) => x + 1);
    }
  }, [startTime, endTime, duration, isDragging]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onSeeking = () => {
      if (v.currentTime < startRef.current) v.currentTime = startRef.current;
      else if (v.currentTime > endRef.current) v.currentTime = endRef.current;
    };
    v.addEventListener("seeking", onSeeking);
    v.addEventListener("seeked", handlePlaybackTick);
    return () => {
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("seeked", handlePlaybackTick);
    };
  }, [duration, videoUrl, handlePlaybackTick]);

  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = v.duration;
    if (!Number.isFinite(d) || d <= 0) {
      onLoadError?.("Could not read video duration.");
      return;
    }
    setDuration(d);
    onDurationLoaded(d);
  };

  const handleTrackClick = (e: React.MouseEvent) => {
    if (isDragging) return;
    const t = getTimeFromClientX(e.clientX);
    if (t >= startTime && t <= endTime && videoRef.current) {
      videoRef.current.currentTime = t;
      setTick((x) => x + 1);
    }
  };

  const handleTrackMouseMove = (e: React.MouseEvent) => {
    if (isDragging) return;
    const t = getTimeFromClientX(e.clientX);
    const pct = duration > 0 ? (t / duration) * 100 : 0;
    const inRange = t >= startTime && t <= endTime;
    setScrubber({ visible: inRange, pct });
  };

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // Use refs so we always read the latest values even if the closure is stale.
    const st = startRef.current;
    const en = endRef.current;
    const len = en - st;

    if (v.paused || v.ended) {
      if (len <= 0) {
        void v.play();
      } else if (v.currentTime < st || v.currentTime >= en - END_EPS) {
        v.currentTime = st;
      } else if (fractionIntoClip(v.currentTime, st, en) < 0.1) {
        v.currentTime = st;
      }
      void v.play();
    } else {
      v.pause();
    }
    setTick((x) => x + 1);
  }, []);

  useEffect(() => {
    if (!file || duration <= 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, duration, togglePlay]);

  const v = videoRef.current;
  const cur = v?.currentTime ?? 0;
  const paused = v?.paused ?? true;

  const startPercent = duration > 0 ? (startTime / duration) * 100 : 0;
  const endPercent = duration > 0 ? (endTime / duration) * 100 : 0;
  const rangeW = endPercent - startPercent;
  let progressInBar = 0;
  if (rangeW > 0 && duration > 0) {
    const rangeDur = endTime - startTime;
    if (rangeDur > 0) {
      const frac = Math.max(0, Math.min(1, (cur - startTime) / rangeDur));
      progressInBar = frac * rangeW;
    }
  }

  if (!file || !videoUrl) return null;

  return (
    <div className="video-preview-section">
      <div className="video-container">
        <video
          ref={videoRef}
          className="trim-preview-video"
          src={videoUrl}
          preload="metadata"
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          onLoadedData={() => setTick((x) => x + 1)}
          onError={() => onLoadError?.("Could not preview this video. Try MP4 or another format.")}
          onClick={(e) => {
            const vid = videoRef.current;
            if (!vid || !vid.paused) return;
            const len = endTime - startTime;
            if (len <= 0) return;
            if (vid.currentTime >= endTime - END_EPS || vid.currentTime < startTime) {
              e.preventDefault();
              vid.currentTime = startTime;
              void vid.play();
            }
          }}
        >
          Video preview not available.
        </video>
      </div>

      {duration > 0 && (
        <div className="timeline-controls">
          <div className="timeline-header">
            <h4>Trim Timeline</h4>
            <div className="time-info">
              <span>{formatClipTime(cur)}</span> / <span>{formatClipTime(duration)}</span>
            </div>
          </div>

          <div className="timeline-container">
            <div
              ref={trackRef}
              className="timeline-track"
              onClick={handleTrackClick}
              onMouseMove={handleTrackMouseMove}
              onMouseLeave={() => setScrubber((s) => ({ ...s, visible: false }))}
              role="presentation"
            >
              <div
                className="timeline-progress"
                style={{
                  width: `${progressInBar}%`,
                  left: `${startPercent}%`,
                }}
              />
              <div className="timeline-range">
                <button
                  type="button"
                  className="range-handle range-handle-start"
                  aria-label="Trim start"
                  style={{ left: `${startPercent}%` }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    startRef.current = startTime;
                    lastDragTypeRef.current = "start";
                    if (videoRef.current) videoRef.current.currentTime = startTime;
                    setIsDragging("start");
                    setTick((x) => x + 1);
                  }}
                />
                <div
                  className="range-selection"
                  style={{
                    left: `${startPercent}%`,
                    width: `${rangeW}%`,
                  }}
                />
                <button
                  type="button"
                  className="range-handle range-handle-end"
                  aria-label="Trim end"
                  style={{ left: `${endPercent}%` }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    endRef.current = endTime;
                    if (videoRef.current) videoRef.current.currentTime = endTime;
                    setIsDragging("end");
                    setTick((x) => x + 1);
                  }}
                />
              </div>
              {scrubber.visible && (
                <div
                  className="timeline-scrubber"
                  style={{ left: `${scrubber.pct}%`, transform: "translateX(-50%)" }}
                >
                  <div className="scrubber-line" />
                </div>
              )}
            </div>
          </div>

          <div className="time-inputs clip-time-row">
            <div className="time-item">
              <p className="time-label">Start</p>
              <p className="time-value">{formatClipTime(startTime)}</p>
            </div>
            <div className="time-item">
              <p className="time-label">End</p>
              <p className="time-value">{formatClipTime(endTime)}</p>
            </div>
            <div className="time-item">
              <p className="time-label">Length</p>
              <p className="time-value">{formatClipTime(endTime - startTime)}</p>
            </div>
          </div>

          <div className="play-controls">
            <button type="button" className="control-button" onClick={togglePlay}>
              {paused ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              )}
              <span>{paused ? "Play" : "Pause"}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
