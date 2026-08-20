import { LunaUnload, Tracer, ftch } from "@luna/core";
import { MediaItem } from "@luna/lib";
import { setLyrics } from "./lyricsPanel";

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

MediaItem.onMediaTransition(unloads, async (track) => {
    try {
        const [title, artist, album] = await Promise.all([
            track.title(),
            track.artist(),
            track.album(),
        ]);

        if (!title) {
            return;
        }

        const artistName = artist?.name ?? "";
        const albumName = album ? await album.title() : "";

        trace.log(`Track: ${title} - ${artistName}`);

        try {
            const tidalLyrics = await track.lyrics();

            trace.log("TIDAL lyrics object:", tidalLyrics);

            const hasTidalLyrics =
                !!tidalLyrics &&
                (
                    (typeof tidalLyrics.lyrics === "string" && tidalLyrics.lyrics.trim().length > 0) ||
                    (typeof tidalLyrics.subtitles === "string" && tidalLyrics.subtitles.trim().length > 0) ||
                    (typeof tidalLyrics.text === "string" && tidalLyrics.text.trim().length > 0)
                );

            if (hasTidalLyrics) {
                trace.log(`TIDAL has usable lyrics: ${title}`);
                trace.log("Lyrics:", tidalLyrics.lyrics);
                trace.log("Subtitles:", tidalLyrics.subtitles);

                setLyrics({
                    title,
                    artist: artistName,
                    plainLyrics: tidalLyrics.lyrics,
                    syncedLyrics: tidalLyrics.subtitles,
                });
            } else {
                trace.log(`TIDAL returned no usable lyrics: ${title}`);
            }
        } catch (error) {
            trace.log(`TIDAL lyrics request failed: ${title}`);
        }

        const lyrics = await getLRCLIBLyrics(
            title,
            artistName,
            albumName
        );

        if (!lyrics) {
            trace.log(`LRCLIB also has no lyrics: ${title}`);
            return;
        }

        trace.log(`LRCLIB FOUND LYRICS: ${title}`);
        trace.log(lyrics);

        setLyrics({
            title,
            artist: artistName,
            plainLyrics: lyrics.plainLyrics,
            syncedLyrics: lyrics.syncedLyrics,
        });
    } catch (error) {
        trace.msg.err("LRCLIB error:", error);
    }
});
