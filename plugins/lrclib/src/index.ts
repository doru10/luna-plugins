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

let transitionId = 0;
let toastElement: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function showLRCLIBToast(synced: boolean) {
    toastElement?.remove();

    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }

    const toast = document.createElement("div");
    toastElement = toast;

    const title = document.createElement("div");
    title.textContent = "LRCLIB";

    Object.assign(title.style, {
        fontWeight: "700",
        fontSize: "14px",
    });

    const message = document.createElement("div");
    message.textContent = synced
        ? "Synced lyrics loaded"
        : "Lyrics loaded";

    Object.assign(message.style, {
        opacity: "0.72",
        fontSize: "12px",
        marginTop: "2px",
    });

    toast.append(title, message);

    Object.assign(toast.style, {
        position: "fixed",
        right: "24px",
        bottom: "104px",
        zIndex: "2147483646",
        color: "#fff",
        background: "rgba(22, 22, 22, 0.96)",
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: "10px",
        padding: "11px 15px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        pointerEvents: "none",
        transition: "opacity 180ms ease",
    });

    document.body.appendChild(toast);

    toastTimer = setTimeout(() => {
        toast.style.opacity = "0";

        setTimeout(() => {
            toast.remove();

            if (toastElement === toast) {
                toastElement = null;
            }
        }, 200);
    }, 2800);
}

unloads.add(() => {
    toastElement?.remove();
    toastElement = null;

    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }
});

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

function plainFromSynced(value?: string | null) {
    if (!value) return "";

    return value
        .split("\n")
        .map((line) => line.replace(/^\[[0-9:.]+\]\s*/, ""))
        .join("\n")
        .trim();
}

async function findTrackQuery(
    trackId: string,
    timeoutMs = 5000,
): Promise<[string, any] | null> {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        const state = redux.store.getState();

        const entry = Object.entries(
            state.tidalOpenPlatformApi?.queries ?? {},
        ).find(([_, query]: [string, any]) =>
            query?.endpointName === "getTracksById" &&
            String(query?.originalArgs?.id) === trackId &&
            query?.status === "fulfilled" &&
            query?.data?.data
        );

        if (entry) {
            return entry as [string, any];
        }

        await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return null;
}

async function injectNativeLRCLIBLyrics(
    trackId: string,
    lyrics: LRCLIBResult,
) {
    const queryEntry = await findTrackQuery(trackId);

    if (!queryEntry) {
        trace.log(
            `Could not find fulfilled getTracksById query for ${trackId}`,
        );

        return false;
    }

    const [queryCacheKey, targetQuery] = queryEntry;

    const payload = structuredClone(targetQuery.data);

    const countryCode =
        targetQuery.originalArgs?.countryCode ?? "GB";

    const lrclibId =
        String(lyrics.id ?? trackId);

    const entityId =
        `lrclib-${trackId}-${lrclibId}`;

    const plainLyrics =
        lyrics.plainLyrics?.trim() ||
        plainFromSynced(lyrics.syncedLyrics);

    const lyricEntity = {
        id: entityId,
        type: "lyrics",
        attributes: {
            text: plainLyrics,

            lrcText:
                lyrics.syncedLyrics?.trim() || null,

            technicalStatus: "OK",

            provider: {
                source: "THIRD_PARTY",
                name: "LRCLIB",
                commonTrackId: lrclibId,
                lyricsId: lrclibId,
            },

            direction: "LEFT_TO_RIGHT",
        },
    };

    payload.data.relationships ??= {};

    payload.data.relationships.lyrics = {
        data: [
            {
                id: entityId,
                type: "lyrics",
            },
        ],

        links: {
            self:
                `/tracks/${trackId}/relationships/lyrics?countryCode=${countryCode}`,
        },
    };

    payload.included ??= [];

    payload.included = payload.included.filter(
        (item: any) => item?.type !== "lyrics",
    );

    payload.included.push(lyricEntity);

    trace.log(
        "Injecting native LRCLIB lyrics entity:",
        lyricEntity,
    );

    redux.store.dispatch({
        type: "tidalOpenPlatformApi/executeQuery/fulfilled",

        payload,

        meta: {
            fulfilledTimeStamp: Date.now(),

            arg: {
                type: "query",
                subscribe: false,
                endpointName: "getTracksById",
                originalArgs: targetQuery.originalArgs,
                queryCacheKey,
            },

            requestId: targetQuery.requestId,
            requestStatus: "fulfilled",
        },
    });

    const stateAfter = redux.store.getState();

    const relationship =
        stateAfter.entities?.tracks?.entities?.[trackId]
            ?.relationships?.lyrics;

    const inserted =
        relationship?.data?.some(
            (item: any) => item?.id === entityId,
        ) === true;

    if (!inserted) {
        trace.log(
            `Native lyrics relationship was not created for ${trackId}`,
        );

        return false;
    }

    trace.log(
        `Native LRCLIB relationship created for ${trackId}`,
    );

    showLRCLIBToast(
        !!lyrics.syncedLyrics?.trim(),
    );

    return true;
}

MediaItem.onMediaTransition(
    unloads,
    async (track: any) => {
        const thisTransition = ++transitionId;

        try {
            const trackId = String(track.id);

            const [title, artist, album] =
                await Promise.all([
                    track.title(),
                    track.artist(),
                    track.album(),
                ]);

            if (!title) return;

            const artistName =
                artist?.name ?? "";

            const albumName =
                album ? await album.title() : "";

            trace.log(
                `Track changed: ${title} - ${artistName}`,
            );

            const queryEntry =
                await findTrackQuery(trackId);

            if (thisTransition !== transitionId) {
                return;
            }

            if (!queryEntry) {
                trace.log(
                    `No Open Platform track query for ${title}`,
                );

                return;
            }

            const [, trackQuery] = queryEntry;

            const nativeLyrics =
                trackQuery.data?.data
                    ?.relationships?.lyrics?.data;

            if (
                Array.isArray(nativeLyrics) &&
                nativeLyrics.length > 0
            ) {
                trace.log(
                    `TIDAL native lyrics already available: ${title}`,
                );

                return;
            }

            trace.log(
                `TIDAL native lyrics missing: ${title}`,
            );

            const lyrics =
                await getLRCLIBLyrics(
                    title,
                    artistName,
                    albumName,
                );

            if (thisTransition !== transitionId) {
                trace.log(
                    `Ignoring stale LRCLIB result: ${title}`,
                );

                return;
            }

            if (!lyrics) {
                trace.log(
                    `LRCLIB also has no lyrics: ${title}`,
                );

                return;
            }

            trace.log(
                `LRCLIB FOUND LYRICS: ${title}`,
            );

            const success =
                await injectNativeLRCLIBLyrics(
                    trackId,
                    lyrics,
                );

            if (success) {
                trace.log(
                    `LRCLIB injected into TIDAL native lyrics UI: ${title}`,
                );
            }
        } catch (error) {
            trace.msg.err(
                "LRCLIB native fallback error:",
                error,
            );
        }
    },
);
