import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background } from "./Background";
import { Word } from "./Word";

interface WordTiming {
  word: string;
  start: number;
  end: number;
}

interface Segment {
  start: number;
  end: number;
  text: string;
  words: WordTiming[];
}

interface Timings {
  segments: Segment[];
}

interface Props {
  timings: Timings;
  bgImages: string[];
}

// --- Corners only ---
const CORNERS = [
  { top: 180,    left: 180,   right: undefined, bottom: undefined, textAlign: "left"  },
  { top: 180,    right: 180,  left: undefined,  bottom: undefined, textAlign: "right" },
  { bottom: 180, left: 180,   right: undefined, top: undefined,    textAlign: "left"  },
  { bottom: 180, right: 180,  left: undefined,  top: undefined,    textAlign: "right" },
] as const;

// --- Font colors ---
const COLORS = [
  "#FFFFFF", "#FFD700", "#FF6B9D", "#00E5FF",
  "#B8FF3C", "#FF9A3C", "#C77DFF", "#3CFFB8",
];

import { FONTS } from "./fonts";

// --- Entrance animations ---
type AnimStyle = "slideUp" | "slideDown" | "slideLeft" | "slideRight" | "zoomIn";
const ANIMS: AnimStyle[] = ["slideUp", "slideDown", "slideLeft", "slideRight", "zoomIn"];

// Deterministic "random" from segment index so it's stable across frames
const pick = <T,>(arr: readonly T[], index: number): T => arr[index % arr.length];

const BREAK_AT = 15; // wrap after this many chars

const wrapWords = (words: WordTiming[]): WordTiming[][] => {
  const lines: WordTiming[][] = [];
  let current: WordTiming[] = [];
  let len = 0;
  for (const w of words) {
    const wLen = w.word.trim().length;
    if (len > 0 && len + wLen > BREAK_AT) {
      lines.push(current);
      current = [];
      len = 0;
    }
    current.push(w);
    len += wLen;
  }
  if (current.length) lines.push(current);
  return lines;
};

// Dynamic font size — bigger now since lines are shorter after wrapping
const getFontSize = (text: string): number => {
  const len = text.trim().length;
  if (len < 15) return 152;
  if (len < 25) return 136;
  if (len < 35) return 124;
  return 112;
};

const FADE_DURATION = 0.3;

const getSegmentEnd = (segment: Segment) => {
  const lastWordEnd = segment.words[segment.words.length - 1]?.end;
  return Number.isFinite(lastWordEnd) ? lastWordEnd : segment.end;
};

export const LyricalVideo: React.FC<Props> = ({ timings, bgImages }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentSec = frame / fps;
  const segments = timings.segments;

  const activeSegIndex = (() => {
    for (let i = segments.length - 1; i >= 0; i--) {
      const segment = segments[i];
      if (currentSec >= segment.start - FADE_DURATION && currentSec <= getSegmentEnd(segment) + FADE_DURATION) return i;
    }
    return -1;
  })();

  const activeSeg = activeSegIndex >= 0 ? segments[activeSegIndex] : null;
  const activeSegEnd = activeSeg ? getSegmentEnd(activeSeg) : 0;

  // Pick stable per-segment values
  const idx       = activeSegIndex >= 0 ? activeSegIndex : 0;
  const corner    = pick(CORNERS, idx);
  const color     = pick(COLORS,  idx + 2);
  const font      = pick(FONTS,   idx + 1);
  const animStyle = pick(ANIMS,   idx);
  const fontSize  = activeSeg ? getFontSize(activeSeg.text) : 64;

  const lineOpacity = activeSeg && activeSegEnd > activeSeg.start
    ? interpolate(
        currentSec,
        [activeSeg.start - FADE_DURATION, activeSeg.start, activeSegEnd, activeSegEnd + FADE_DURATION],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      )
    : activeSeg ? 1 : 0;

  const segStartFrame = activeSeg ? Math.round(activeSeg.start * fps) : 0;
  const entranceProgress = spring({
    frame: frame - segStartFrame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
  });

  const getTransform = (): string => {
    switch (animStyle) {
      case "slideUp":    return `translateY(${interpolate(entranceProgress, [0, 1], [60, 0])}px)`;
      case "slideDown":  return `translateY(${interpolate(entranceProgress, [0, 1], [-60, 0])}px)`;
      case "slideLeft":  return `translateX(${interpolate(entranceProgress, [0, 1], [80, 0])}px)`;
      case "slideRight": return `translateX(${interpolate(entranceProgress, [0, 1], [-80, 0])}px)`;
      case "zoomIn":     return `scale(${interpolate(entranceProgress, [0, 1], [0.7, 1])})`;
    }
  };

  // Gradient direction follows corner
  const gradientStyle = (() => {
    if (corner.bottom !== undefined && corner.left !== undefined)
      return "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 45%)";
    if (corner.bottom !== undefined && corner.right !== undefined)
      return "linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 45%)";
    if (corner.top !== undefined && corner.left !== undefined)
      return "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 45%)";
    return "linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 45%)";
  })();

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Background segments={segments} bgImages={bgImages} />

      <AbsoluteFill style={{ background: gradientStyle }} />

      {activeSeg && (
        <div
          style={{
            position: "absolute",
            top:    corner.top,
            bottom: corner.bottom,
            left:   corner.left,
            right:  corner.right,
            maxWidth: "45%",
            opacity: lineOpacity,
            transform: getTransform(),
            fontFamily: font,
            fontSize,
            lineHeight: 1.4,
            textAlign: corner.textAlign,
            color,
            textShadow: "0 2px 12px rgba(0,0,0,0.9)",
            fontWeight: "bold",
          }}
        >
          {wrapWords(activeSeg.words).map((line, li) => (
            <div key={li}>
              {line.map((w, i) => (
                <Word key={i} word={w.word} />
              ))}
            </div>
          ))}
        </div>
      )}

      <Audio src={staticFile("song.mp3")} />
    </AbsoluteFill>
  );
};
