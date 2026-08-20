import type { LunaUnload } from "@luna/core";

const lunaCore = (globalThis as any).luna?.core?.modules?.["@luna/core"];

if (!lunaCore) {
    throw new Error("@luna/core is not loaded");
}

const { Tracer, ftch } = lunaCore;

const lunaLib = (globalThis as any).luna?.core?.modules?.["@luna/lib"];

if (!lunaLib) {
    throw new Error("@luna/lib is not loaded");
}

const { MediaItem, redux } = lunaLib;

export const { trace } = Tracer("[LRCLIB]");
export const unloads = new Set<LunaUnload>();

type LRCLIBResult = {
    id?: number;
    plainLyrics?: string | null;
    syncedLyrics?: string | null;
    trackName?: string;
    artistName?: string;
    albumName?: string;
};

type DisplayLyrics = {
    title: string;
    artist: string;
    source: "TIDAL" | "LRCLIB";
    text: string;
};

let currentLyrics: DisplayLyrics | null = null;
let lyricsButton: HTMLButtonElement | null = null;
let lyricsOverlay: HTMLDivElement | null = null;
let lastTrackId: string | null = null;

async function getLRCLIBLyrics(
    title: string,
    artist: string,
    album: string,
): Promise<LRCLIBResult | null> {
    const params = new URLSearchParams({
        track_name: title,
        artist_name: artist,
    });

    if (album) {
        params.set("album_name", album);
    }

    const url = `https://lrclib.net/api/get?${params}`;

    trace.log(`Requesting: ${url}`);

    try {
        const result = await ftch.json(url) as LRCLIBResult;

        if (!result?.plainLyrics && !result?.syncedLyrics) {
            return null;
        }

        return result;
    } catch (error) {
        trace.log(`No LRCLIB result for ${title}`);
        return null;
    }
}

function cleanSyncedLyrics(value?: string | null) {
    if (!value) return "";

    return value
        .replace(/^\[[0-9:.]+\]\s*/gm, "")
        .trim();
}

function closeLyricsOverlay() {
    lyricsOverlay?.remove();
    lyricsOverlay = null;
}

function openLyricsOverlay() {
    if (!currentLyrics) return;

    closeLyricsOverlay();

    const overlay = document.createElement("div");
    lyricsOverlay = overlay;

    Object.assign(overlay.style, {
        position: "fixed",
        inset: "0",
        zIndex: "2147483646",
        background: "rgba(0, 0, 0, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px",
        boxSizing: "border-box",
    });

    const panel = document.createElement("div");

    Object.assign(panel.style, {
        width: "min(760px, 100%)",
        maxHeight: "85vh",
        background: "#111",
        color: "#fff",
        borderRadius: "16px",
        boxShadow: "0 20px 80px rgba(0, 0, 0, 0.6)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    });

    const header = document.createElement("div");

    Object.assign(header.style, {
        padding: "22px 24px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        position: "relative",
    });

    const title = document.createElement("div");
    title.textContent = currentLyrics.title;

    Object.assign(title.style, {
        fontSize: "22px",
        fontWeight: "700",
        paddingRight: "50px",
    });

    const subtitle = document.createElement("div");
    subtitle.textContent =
        `${currentLyrics.artist} • ${currentLyrics.source}`;

    Object.assign(subtitle.style, {
        marginTop: "6px",
        opacity: "0.65",
        fontSize: "14px",
    });

    const close = document.createElement("button");
    close.textContent = "×";
    close.title = "Close lyrics";

    Object.assign(close.style, {
        position: "absolute",
        right: "18px",
        top: "14px",
        border: "0",
        background: "transparent",
        color: "white",
        fontSize: "32px",
        cursor: "pointer",
    });

    close.onclick = closeLyricsOverlay;

    header.append(title, subtitle, close);

    const body = document.createElement("div");
    body.textContent = currentLyrics.text;

    Object.assign(body.style, {
        padding: "24px",
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        fontSize: "20px",
        lineHeight: "1.7",
    });

    panel.append(header, body);
    overlay.append(panel);

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
            closeLyricsOverlay();
        }
    });

    document.body.appendChild(overlay);
}

function ensureLyricsButton() {
    if (lyricsButton?.isConnected) {
        return lyricsButton;
    }

    const button = document.createElement("button");
    button.id = "lrclib-lyrics-button";
    button.textContent = "♫ Lyrics";
    button.title = "Open lyrics";

    Object.assign(button.style, {
        position: "fixed",
        right: "24px",
        bottom: "100px",
        zIndex: "2147483645",
        border: "1px solid rgba(255,255,255,0.18)",
        borderRadius: "999px",
        padding: "10px 16px",
        background: "rgba(20,20,20,0.94)",
        color: "white",
        fontSize: "14px",
        fontWeight: "600",
        cursor: "pointer",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        display: "none",
    });

    button.onclick = openLyricsOverlay;

    document.body.appendChild(button);
    lyricsButton = button;

    return button;
}

function hideLyricsButton() {
    currentLyrics = null;
    closeLyricsOverlay();

    if (lyricsButton) {
        lyricsButton.style.display = "none";
    }
}

function showLyrics(data: DisplayLyrics) {
    currentLyrics = data;

    const button = ensureLyricsButton();
    button.textContent =
        data.source === "LRCLIB"
            ? "♫ Lyrics • LRCLIB"
            : "♫ Lyrics";

    button.style.display = "block";
}

ensureLyricsButton();

unloads.add(() => {
    closeLyricsOverlay();
    lyricsButton?.remove();
    lyricsButton = null;
    currentLyrics = null;
});

MediaItem.onMediaTransition(unloads, async (track: any) => {
    try {
        const trackId = String(track.id);

        if (trackId === lastTrackId) {
            return;
        }

        lastTrackId = trackId;
        hideLyricsButton();

        const [title, artist, album] = await Promise.all([
            track.title(),
            track.artist(),
            track.album(),
        ]);

        if (!title) return;

        const artistName = artist?.name ?? "";
        const albumName = album ? await album.title() : "";

        trace.log(`Track changed: ${title} - ${artistName}`);

        try {
            const tidalLyrics = await track.lyrics();

            const tidalPlain =
                typeof tidalLyrics?.lyrics === "string"
                    ? tidalLyrics.lyrics.trim()
                    : typeof tidalLyrics?.text === "string"
                      ? tidalLyrics.text.trim()
                      : "";

            const tidalSynced =
                typeof tidalLyrics?.subtitles === "string"
                    ? tidalLyrics.subtitles.trim()
                    : "";

            if (tidalPlain || tidalSynced) {
                trace.log(`TIDAL already has lyrics: ${title}`);

                showLyrics({
                    title,
                    artist: artistName,
                    source: "TIDAL",
                    text:
                        tidalPlain ||
                        cleanSyncedLyrics(tidalSynced),
                });

                return;
            }

            trace.log(`TIDAL has no usable lyrics: ${title}`);
        } catch {
            trace.log(`TIDAL lyrics request failed: ${title}`);
        }

        const lyrics = await getLRCLIBLyrics(
            title,
            artistName,
            albumName,
        );

        if (!lyrics) {
            trace.log(`LRCLIB also has no lyrics: ${title}`);
            return;
        }

        trace.log(`LRCLIB FOUND LYRICS: ${title}`);

        const displayText =
            lyrics.plainLyrics?.trim() ||
            cleanSyncedLyrics(lyrics.syncedLyrics);

        if (!displayText) return;

        showLyrics({
            title,
            artist: artistName,
            source: "LRCLIB",
            text: displayText,
        });

        const lyricsPayload = {
            trackId: track.id,
            lyricsProvider: "LRCLIB",
            providerCommontrackId: lyrics.id ?? track.id,
            providerLyricsId: lyrics.id ?? track.id,
            lyrics: lyrics.plainLyrics ?? "",
            subtitles: lyrics.syncedLyrics ?? null,
            isRightToLeft: false,
        };

        try {
            redux.store.dispatch({
                type: "content/LOAD_ITEM_LYRICS_SUCCESS",
                payload: lyricsPayload,
            });

            trace.log(`Injected LRCLIB lyrics into TIDAL store: ${title}`);
        } catch (error) {
            trace.log("Native lyrics store injection failed:", error);
        }
    } catch (error) {
        trace.msg.err("LRCLIB transition fallback error:", error);
    }
});
