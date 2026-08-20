import { LunaUnload, Tracer, ftch } from "@luna/core";
import { MediaItem } from "@luna/lib";

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

            if (tidalLyrics) {
                trace.log(`TIDAL has lyrics: ${title}`);
                return;
            }
        } catch {
            trace.log(`TIDAL has no lyrics: ${title}`);
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
    } catch (error) {
        trace.msg.err("LRCLIB error:", error);
    }
});
