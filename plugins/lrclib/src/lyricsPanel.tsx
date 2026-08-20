import React, { useEffect, useState } from "react";

export type LyricsData = {
  title: string;
  artist: string;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

let currentLyrics: LyricsData | null = null;
const listeners = new Set<(data: LyricsData | null) => void>();

export function setLyrics(data: LyricsData | null) {
  currentLyrics = data;
  for (const listener of listeners) listener(data);
}

export function LyricsPanel() {
  const [data, setData] = useState<LyricsData | null>(currentLyrics);

  useEffect(() => {
    const listener = (value: LyricsData | null) => setData(value);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  if (!data) return <div style={{ padding: 24 }}>No lyrics loaded.</div>;

  const text = data.syncedLyrics || data.plainLyrics || "No lyrics available.";

  return (
    <div style={{ padding: 24, overflowY: "auto", height: "100%" }}>
      <h2>{data.title}</h2>
      <div style={{ opacity: 0.7, marginBottom: 20 }}>{data.artist}</div>
      <div style={{ whiteSpace: "pre-wrap", fontSize: 18, lineHeight: 1.6 }}>
        {text}
      </div>
    </div>
  );
}
