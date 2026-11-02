import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";

export interface Clip {
  id: number;
  image: string | null;
  start: number;
  end: number;
  label: string;
}

export interface InstrumentalClip {
  id: number;
  slot: number;
  start: number;
  end: number;
  image?: string;
}

interface Props {
  clips: Clip[];
  instrumentalClips: InstrumentalClip[];
  images: string[];
  coverImage?: string | null;
  totalDur: number;
  onChange: (clips: Clip[]) => void;
  onInstrumentalChange: (clips: InstrumentalClip[]) => void;
}

const MIN_DUR = 0.5;
const TRACK_H = 80;
const MIN_PX_PER_SEC = 4;
const MAX_PX_PER_SEC = 32;

const CLIP_COLORS = [
  "#6366f1", "#059669", "#d97706", "#dc2626",
  "#7c3aed", "#0891b2", "#be185d", "#15803d",
];

interface TimelineClip {
  kind: "lyric" | "instrumental";
  id: number;
  image: string | null;
  label: string;
  start: number;
  end: number;
  slot?: number;
}

export const Timeline: React.FC<Props> = ({ clips, instrumentalClips, images, coverImage, totalDur, onChange, onInstrumentalChange }) => {
  const dragRef = useRef<{
    type: "move" | "left" | "right";
    clipIndex: number;
    startX: number;
    origClips: TimelineClip[];
  } | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [showReplace, setShowReplace] = useState<number | null>(null);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(8);
  const toX = (sec: number) => sec * pixelsPerSecond;
  const rulerInterval = pixelsPerSecond < 6 ? 30 : pixelsPerSecond < 10 ? 20 : 10;

  const timelineClips: TimelineClip[] = [
    ...clips.map((clip) => ({ ...clip, kind: "lyric" as const })),
    ...instrumentalClips.map((clip) => ({
      ...clip,
      kind: "instrumental" as const,
      image: clip.image ?? "cover",
      label: "Instrumental cover",
    })),
  ].sort((a, b) => a.start - b.start);

  const commitTimeline = (next: TimelineClip[]) => {
    let slot = 0;
    const nextLyrics: Clip[] = [];
    const nextInstrumentals: InstrumentalClip[] = [];
    for (const clip of next) {
      if (clip.kind === "lyric") {
        nextLyrics.push({ id: clip.id, image: clip.image, start: clip.start, end: clip.end, label: clip.label });
        slot += 1;
      } else {
        nextInstrumentals.push({ id: clip.id, slot, start: clip.start, end: clip.end, image: clip.image ?? "cover" });
      }
    }
    onChange(nextLyrics);
    onInstrumentalChange(nextInstrumentals);
  };

  const onMouseDown = useCallback((e: React.MouseEvent, clipIndex: number, type: "move" | "left" | "right") => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { type, clipIndex, startX: e.clientX, origClips: timelineClips.map((clip) => ({ ...clip })) };
    const clip = timelineClips[clipIndex];
    setSelected(`${clip.kind}:${clip.id}`);
  }, [timelineClips]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { type, clipIndex, startX, origClips } = dragRef.current;
      const delta = (e.clientX - startX) / pixelsPerSecond;
      const next = origClips.map((clip) => ({ ...clip }));
      const clip = next[clipIndex];
      const prev = next[clipIndex - 1];
      const nextClip = next[clipIndex + 1];

      if (type === "move") {
        const duration = clip.end - clip.start;
        clip.start = Math.max((prev?.start ?? 0) + (prev ? MIN_DUR : 0), Math.min((nextClip?.end ?? totalDur) - (nextClip ? MIN_DUR : 0) - duration, clip.start + delta));
        clip.end = clip.start + duration;
        if (prev) prev.end = clip.start;
        if (nextClip) nextClip.start = clip.end;
      } else if (type === "right") {
        clip.end = Math.max(clip.start + MIN_DUR, Math.min((nextClip?.end ?? totalDur) - MIN_DUR, clip.end + delta));
        if (nextClip) nextClip.start = clip.end;
      } else if (type === "left") {
        clip.start = Math.max((prev?.start ?? 0) + MIN_DUR, Math.min(clip.end - MIN_DUR, clip.start + delta));
        if (prev) prev.end = clip.start;
      }

      commitTimeline(next);
    };

    const onMouseUp = () => { dragRef.current = null; };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [timelineClips, totalDur, onChange, onInstrumentalChange, pixelsPerSecond]);

  const deleteClip = (index: number) => {
    if (timelineClips.length <= 1) return;
    const next = timelineClips.map((clip) => ({ ...clip }));
    if (index > 0) next[index - 1].end = next[index].end;
    else if (next[index + 1]) next[index + 1].start = next[index].start;
    next.splice(index, 1);
    commitTimeline(next);
    setSelected(null);
    setShowReplace(null);
  };

  const replaceImage = (clipIndex: number, image: string) => {
    const next = timelineClips.map((clip) => ({ ...clip }));
    next[clipIndex].image = image;
    commitTimeline(next);
    setShowReplace(null);
  };

  const addInstrumentalClip = (start: number, end: number) => {
    const nextId = Math.max(-1, ...instrumentalClips.map((clip) => clip.id)) + 1;
    const image = coverImage ? "cover" : images[0] ?? null;
    commitTimeline([
      ...timelineClips,
      {
        kind: "instrumental",
        id: nextId,
        slot: 0,
        image,
        label: "Instrumental cover",
        start,
        end,
      },
    ].sort((a, b) => a.start - b.start));
  };

  const timelineGaps = timelineClips.reduce<{ start: number; end: number }[]>((gaps, clip, index) => {
    const start = index === 0 ? 0 : timelineClips[index - 1].end;
    if (clip.start - start >= MIN_DUR) gaps.push({ start, end: clip.start });
    if (index === timelineClips.length - 1 && totalDur - clip.end >= MIN_DUR) {
      gaps.push({ start: clip.end, end: totalDur });
    }
    return gaps;
  }, []);

  const totalW = toX(totalDur);
  const coverImageSrc = coverImage ? `/api/cover-image?v=${encodeURIComponent(coverImage)}` : "";
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

        <div className="timeline-track" style={{ width: totalW, height: TRACK_H }}>
          {timelineGaps.map((gap) => (
            <button
              key={`gap:${gap.start}`}
              type="button"
              className="timeline-gap-add"
              style={{ left: toX(gap.start), width: toX(gap.end - gap.start) }}
              aria-label={`Add clip from ${gap.start.toFixed(1)} to ${gap.end.toFixed(1)} seconds`}
              title={`Add clip (${(gap.end - gap.start).toFixed(1)}s)`}
              onClick={() => addInstrumentalClip(gap.start, gap.end)}
            >
              <span><Plus aria-hidden="true" size={14} /> Add</span>
            </button>
          ))}
          {timelineClips.map((clip, i) => {
            const clipKey = `${clip.kind}:${clip.id}`;
            const isSelected = selected === clipKey;
            const isCover = clip.kind === "instrumental" && clip.image === "cover";
            const imageUrl = clip.kind === "instrumental"
              ? isCover ? coverImage ? coverImageSrc : "" : clip.image ? `/api/image/${encodeURIComponent(clip.image)}` : ""
              : clip.image ? `/api/image/${encodeURIComponent(clip.image)}` : "";
            return (
              <div
                key={clipKey}
                className={`clip-block ${isSelected ? "selected" : ""}`}
                style={{
                  left: toX(clip.start),
                  width: toX(clip.end - clip.start),
                  background: imageUrl ? "transparent" : CLIP_COLORS[i % CLIP_COLORS.length],
                  zIndex: isSelected ? 3 : 1,
                }}
                onClick={() => { setSelected(clipKey); setShowReplace(null); }}
              >
                {imageUrl && <img className="clip-preview" src={imageUrl} alt={clip.image ?? ""} draggable={false} />}
                <div className="clip-handle left" onMouseDown={(e) => onMouseDown(e, i, "left")} />
                <div className="clip-body" onMouseDown={(e) => onMouseDown(e, i, "move")}>
                  <div className="clip-image-name">{clip.kind === "instrumental" ? (isCover ? "Cover image" : clip.image ?? "no image") : clip.image ?? "no image"}</div>
                  <div className="clip-label">{clip.label}</div>
                  <div className="clip-dur">{(clip.end - clip.start).toFixed(1)}s</div>
                </div>
                <div className="clip-handle right" onMouseDown={(e) => onMouseDown(e, i, "right")} />
                {isSelected && (
                  <div className="clip-actions">
                    <button
                      title="Replace image"
                      aria-lable="Replace image"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowReplace(i); }}
                    >
                      <RefreshCcw aria-hidden="true" size={16} color="aqua" />
                    </button>
                    <button
                      aria-label="Delete clip"
                      title="Delete clip"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); deleteClip(i); }}
                    >
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
            {coverImage && timelineClips[showReplace]?.kind === "instrumental" && (
              <button type="button" className="image-picker-item" onClick={() => replaceImage(showReplace, "cover")}>
                <img src={coverImageSrc} alt="" />
                <span>Instrumental cover</span>
              </button>
            )}
            {images.map((img) => (
              <button type="button" className="image-picker-item" key={img} onClick={() => replaceImage(showReplace, img)}>
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
