import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";

export interface Clip {
  id: number;
  image: string | null;
  start: number;
  end: number;
  label: string;
}

interface Props {
  clips: Clip[];
  images: string[];
  totalDur: number;
  onChange: (clips: Clip[]) => void;
}

const MIN_DUR = 0.5;
const TRACK_H = 80;
const MIN_PX_PER_SEC = 4;
const MAX_PX_PER_SEC = 32;

const CLIP_COLORS = [
  "#6366f1", "#059669", "#d97706", "#dc2626",
  "#7c3aed", "#0891b2", "#be185d", "#15803d",
];

export const Timeline: React.FC<Props> = ({ clips, images, totalDur, onChange }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    type: "move" | "left" | "right";
    clipIndex: number;
    startX: number;
    origClips: Clip[];
  } | null>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [showReplace, setShowReplace] = useState<number | null>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(8);
  const toX = (sec: number) => sec * pixelsPerSecond;
  const rulerInterval = pixelsPerSecond < 6 ? 30 : pixelsPerSecond < 10 ? 20 : 10;

  const onMouseDown = useCallback(
    (e: React.MouseEvent, clipIndex: number, type: "move" | "left" | "right") => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { type, clipIndex, startX: e.clientX, origClips: clips.map((c) => ({ ...c })) };
      setSelected(clipIndex);
    },
    [clips]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { type, clipIndex, startX, origClips } = dragRef.current;
      const ds = (e.clientX - startX) / pixelsPerSecond;
      const next = origClips.map((c) => ({ ...c }));
      const clip = next[clipIndex];
      const prev = next[clipIndex - 1];
      const nextClip = next[clipIndex + 1];

      if (type === "move") {
        const dur = clip.end - clip.start;
        const minStart = prev ? prev.end : 0;
        const maxStart = nextClip ? nextClip.start - dur : totalDur - dur;
        const newStart = Math.max(minStart, Math.min(maxStart, clip.start + ds));
        clip.start = newStart;
        clip.end = newStart + dur;
        if (prev) prev.end = clip.start;
        if (nextClip) nextClip.start = clip.end;
      } else if (type === "right") {
        const minEnd = clip.start + MIN_DUR;
        const maxEnd = nextClip ? nextClip.end - MIN_DUR : totalDur;
        const newEnd = Math.max(minEnd, Math.min(maxEnd, clip.end + ds));
        clip.end = newEnd;
        if (nextClip) nextClip.start = newEnd;
      } else if (type === "left") {
        const minStart = prev ? prev.start + MIN_DUR : 0;
        const maxStart = clip.end - MIN_DUR;
        const newStart = Math.max(minStart, Math.min(maxStart, clip.start + ds));
        clip.start = newStart;
        if (prev) prev.end = newStart;
      }

      onChange(next);
    };

    const onMouseUp = () => { dragRef.current = null; };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [clips, totalDur, onChange, pixelsPerSecond]);

  const deleteClip = (index: number) => {
    const next = clips.filter((_, i) => i !== index).map((c, i) => ({ ...c, id: i }));
    if (next.length === 0) return;
    if (index > 0 && next[index - 1]) next[index - 1].end = clips[index].end;
    else if (next[index]) next[index].start = clips[index].start;
    onChange(next);
    setSelected(null);
  };

  const replaceImage = (clipIndex: number, image: string) => {
    onChange(clips.map((c, i) => i === clipIndex ? { ...c, image } : c));
    setShowReplace(null);
  };

  const totalW = toX(totalDur);
  const zoom = (factor: number) => {
    setPixelsPerSecond((current) => Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, current * factor)));
  };

  return (
    <div className="timeline-wrapper">
      <div className="timeline-controls">
        <span>Timeline zoom</span>
        <button type="button" aria-label="Zoom out timeline" title="Zoom out" disabled={pixelsPerSecond <= MIN_PX_PER_SEC} onClick={() => zoom(0.8)}><ZoomOut aria-hidden="true" size={16} /></button>
        <button type="button" aria-label="Zoom in timeline" title="Zoom in" disabled={pixelsPerSecond >= MAX_PX_PER_SEC} onClick={() => zoom(1.25)}><ZoomIn aria-hidden="true" size={16} /></button>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-ruler" style={{ width: totalW }}>
          {Array.from({ length: Math.ceil(totalDur / rulerInterval) + 1 }, (_, i) => (
            <div key={i} className="ruler-mark" style={{ left: toX(i * rulerInterval) }}>
              <span>{i * rulerInterval}s</span>
            </div>
          ))}
        </div>

        <div ref={trackRef} className="timeline-track" style={{ width: totalW, height: TRACK_H }}>
          {clips.map((clip, i) => {
            const isSelected = selected === i;
            return (
              <div
                key={clip.id}
                className={`clip-block ${isSelected ? "selected" : ""}`}
                style={{
                  left: toX(clip.start),
                  width: toX(clip.end - clip.start),
                  background: clip.image ? "transparent" : CLIP_COLORS[i % CLIP_COLORS.length],
                }}
                onClick={() => { setSelected(i); setShowReplace(null); }}
              >
                {clip.image && <img className="clip-preview" src={`/api/image/${encodeURIComponent(clip.image)}`} alt={clip.image} draggable={false} />}
                <div className="clip-handle left" onMouseDown={(e) => onMouseDown(e, i, "left")} />
                <div className="clip-body" onMouseDown={(e) => onMouseDown(e, i, "move")}>
                  <div className="clip-image-name">{clip.image ?? "no image"}</div>
                  <div className="clip-label">{clip.label}</div>
                  <div className="clip-dur">{(clip.end - clip.start).toFixed(1)}s</div>
                </div>
                <div className="clip-handle right" onMouseDown={(e) => onMouseDown(e, i, "right")} />
                {isSelected && (
                  <div className="clip-actions">
                    <button onClick={(e) => { e.stopPropagation(); setShowReplace(i); }}>
                      <RefreshCcw aria-hidden="true" size={16} color="aqua" />
                    </button>
                    <button aria-label="Delete clip" title="Delete clip" onClick={(e) => { e.stopPropagation(); deleteClip(i); }}>
                      <Trash2 aria-hidden="true" size={16} color="maroon" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showReplace !== null && (
        <div className="image-picker">
          <p>Pick image for clip {showReplace + 1}:</p>
          <div className="image-picker-list">
            {images.map((img) => (
              <button type="button" className="image-picker-item" key={img} onClick={() => replaceImage(showReplace!, img)}>
                <img src={`/api/image/${encodeURIComponent(img)}`} alt="" />
                <span>{img}</span>
              </button>
            ))}
          </div>
          <button className="cancel" onClick={() => setShowReplace(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
};
