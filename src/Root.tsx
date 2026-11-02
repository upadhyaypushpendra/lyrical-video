import React, { useEffect, useState } from "react";
import { Composition, continueRender, delayRender, staticFile } from "remotion";
import { LyricalVideo } from "./LyricalVideo";

const FPS = 30;
const TOTAL_DURATION_SEC = 160;

interface RenderInputs {
  timings: object;
  bgImages: string[];
  coverImage: string | null;
  instrumentalClips: { start: number; end: number }[] | null;
}

export const Root: React.FC = () => {
  const [inputs, setInputs] = useState<RenderInputs | null>(null);
  const [handle] = useState(() => delayRender("Loading timings"));

  useEffect(() => {
    Promise.all([
      fetch(staticFile("timings.json")).then((response) => {
        if (!response.ok) throw new Error(`Could not load timings (${response.status})`);
        return response.json();
      }),
      fetch(staticFile("bg-images.json")).then((response) => {
        if (!response.ok) throw new Error(`Could not load image list (${response.status})`);
        return response.json();
      }),
      fetch(staticFile("cover-image.json")).then((response) => response.ok ? response.json() : null),
      fetch(staticFile("instrumental-clips.json")).then((response) => response.ok ? response.json() : null),
    ])
      .then(([timings, bgImages, coverImage, instrumentalClips]) => {
        if (!Array.isArray(bgImages)) throw new Error("The background image list is invalid");
        if (coverImage !== null && typeof coverImage !== "string") throw new Error("The cover image name is invalid");
        if (instrumentalClips !== null && !Array.isArray(instrumentalClips)) throw new Error("The instrumental clip list is invalid");
        setInputs({ timings, bgImages, coverImage, instrumentalClips });
        continueRender(handle);
      })
      .catch((error) => {
        console.error("Could not load render inputs:", error);
        setInputs({ timings: { segments: [] }, bgImages: [], coverImage: null, instrumentalClips: null });
        continueRender(handle);
      });
  }, []);

  if (!inputs) return null;

  return (
    <Composition
      id="LyricalVideo"
      component={LyricalVideo}
      durationInFrames={TOTAL_DURATION_SEC * FPS}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ timings: inputs.timings, bgImages: inputs.bgImages, coverImage: inputs.coverImage, instrumentalClips: inputs.instrumentalClips }}
    />
  );
};
