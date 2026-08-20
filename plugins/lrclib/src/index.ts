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

async function getLRCLIBLyrics(
    title: string,
    artist: string,
    album: string
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


trace.log(
    "Available lyrics action builders:",
    Object.keys(lunaCore.buildActions ?? {}).filter((name) =>
        name.includes("LYRICS")
    ),
);

MediaItem.onMediaTransition(unloads, async (track) => {
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

        const lyricsRequestBuilder =
            lunaCore.buildActions?.["content/LOAD_ITEM_LYRICS"];

        if (typeof lyricsRequestBuilder === "function") {
            try {
                const sampleAction = lyricsRequestBuilder({
                    itemId: track.id,
                    itemType: "track",
                });

                trace.log("Sample LOAD_ITEM_LYRICS Redux action:", sampleAction);
            } catch (error) {
                trace.log("Could not inspect lyrics action builder:", error);
            }
        }


        try {
            const tidalLyrics = await track.lyrics();

            const hasTidalLyrics =
                !!tidalLyrics &&
                (
                    (typeof tidalLyrics.lyrics === "string" && tidalLyrics.lyrics.trim().length > 0) ||
                    (typeof tidalLyrics.subtitles === "string" && tidalLyrics.subtitles.trim().length > 0) ||
                    (typeof tidalLyrics.text === "string" && tidalLyrics.text.trim().length > 0)
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

        if (!lyrics) {
            trace.log(`LRCLIB also has no lyrics: ${title}`);
            return;
        }

        trace.log(`LRCLIB FOUND LYRICS: ${title}`);

        await redux.actions["content/LOAD_ITEM_LYRICS_SUCCESS"]({
            trackId: track.id,
            lyricsProvider: "LRCLIB",
            providerCommontrackId: lyrics.id ?? track.id,
            providerLyricsId: lyrics.id ?? track.id,
            lyrics: lyrics.plainLyrics ?? "",
            subtitles: lyrics.syncedLyrics ?? null,
            isRightToLeft: false,
        });

        trace.log(`Injected LRCLIB lyrics into TIDAL store: ${title}`);
    } catch (error) {
        trace.msg.err("LRCLIB transition fallback error:", error);
    }
});
