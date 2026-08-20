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

type NativeLyricsPayload = {
    trackId: string | number;
    lyricsProvider: string;
    providerCommontrackId: string | number;
    providerLyricsId: string | number;
    lyrics: string;
    subtitles: string | null;
    isRightToLeft: boolean;
};

let transitionId = 0;

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

function plainFromSynced(value?: string | null): string {
    if (!value) return "";

    return value
        .split("\n")
        .map((line) => line.replace(/^\[[0-9:.]+\]\s*/, ""))
        .join("\n")
        .trim();
}

async function getLyricsSuccessBuilder(timeoutMs = 4000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const builder =
            lunaCore.buildActions?.["content/LOAD_ITEM_LYRICS_SUCCESS"];

        if (typeof builder === "function") {
            return builder;
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return null;
}

async function injectNativeLyrics(payload: NativeLyricsPayload) {
    const builder = await getLyricsSuccessBuilder();

    if (!builder) {
        const available = Object.keys(lunaCore.buildActions ?? {})
            .filter((name) => name.includes("LYRICS"));

        trace.log(
            "Native LOAD_ITEM_LYRICS_SUCCESS builder unavailable.",
            available,
        );

        return false;
    }

    trace.log("Native lyrics SUCCESS builder found!");

    const action = builder(payload);

    trace.log("Built native lyrics Redux action:", action);

    redux.store.dispatch(action);

    return true;
}

MediaItem.onMediaTransition(unloads, async (track: any) => {
    const thisTransition = ++transitionId;

    try {
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

            const hasTidalLyrics =
                !!tidalLyrics &&
                (
                    (
                        typeof tidalLyrics.lyrics === "string" &&
                        tidalLyrics.lyrics.trim().length > 0
                    ) ||
                    (
                        typeof tidalLyrics.subtitles === "string" &&
                        tidalLyrics.subtitles.trim().length > 0
                    ) ||
                    (
                        typeof tidalLyrics.text === "string" &&
                        tidalLyrics.text.trim().length > 0
                    )
                );

            if (hasTidalLyrics) {
                trace.log(`TIDAL already has lyrics: ${title}`);
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

        if (thisTransition !== transitionId) {
            trace.log(`Ignoring stale LRCLIB result: ${title}`);
            return;
        }

        if (!lyrics) {
            trace.log(`LRCLIB also has no lyrics: ${title}`);
            return;
        }

        trace.log(`LRCLIB FOUND LYRICS: ${title}`);

        const plainLyrics =
            lyrics.plainLyrics?.trim() ||
            plainFromSynced(lyrics.syncedLyrics);

        const payload: NativeLyricsPayload = {
            trackId: track.id,
            lyricsProvider: "LRCLIB",
            providerCommontrackId: lyrics.id ?? track.id,
            providerLyricsId: lyrics.id ?? track.id,
            lyrics: plainLyrics,
            subtitles: lyrics.syncedLyrics ?? null,
            isRightToLeft: false,
        };

        trace.log("LRCLIB native payload:", payload);

        const injected = await injectNativeLyrics(payload);

        if (injected) {
            trace.log(
                `Injected LRCLIB through TIDAL native lyrics action: ${title}`,
            );
        }
    } catch (error) {
        trace.msg.err("LRCLIB transition fallback error:", error);
    }
});
