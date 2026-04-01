import type { PlaybackDto } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { getValidSpotifyAccessToken } from "@/lib/spotify/oauth";

type SpotifyImage = {
  url: string;
};

type SpotifyArtist = {
  name: string;
};

type SpotifyTrack = {
  name: string;
  uri: string | null;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: {
    name: string;
    images: SpotifyImage[];
  };
};

type SpotifyPlaybackState = {
  is_playing: boolean;
  progress_ms: number | null;
  context:
    | {
        uri: string | null;
        type: string | null;
      }
    | null
    | undefined;
  device:
    | {
        id: string | null;
        name: string;
        volume_percent: number | null;
      }
    | null
    | undefined;
  item: SpotifyTrack | null;
};

type SpotifyTrackSearchResponse = {
  tracks: {
    items: SpotifyTrack[];
  };
};

type SpotifyPlaylistSearchResponse = {
  playlists: {
    items: {
      id: string;
      name: string;
      uri: string;
      description: string | null;
      owner: {
        display_name: string | null;
      };
      items: {
        total: number;
      };
      images: SpotifyImage[];
    }[];
  };
};

type SpotifyPlaylistCoverImage = {
  url: string;
  height: number | null;
  width: number | null;
};

type SpotifyApiOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  allowNoContent?: boolean;
};

function buildSpotifyApiUrl(
  path: string,
  query?: SpotifyApiOptions["query"],
) {
  const url = new URL(`https://api.spotify.com/v1${path}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }

      url.searchParams.set(key, String(value));
    }
  }

  return url;
}

async function spotifyApiRequest<T>(
  sessionId: string,
  path: string,
  options: SpotifyApiOptions = {},
) {
  const url = buildSpotifyApiUrl(path, options.query);
  const requestInit = (accessToken: string): RequestInit => ({
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  let { accessToken } = await getValidSpotifyAccessToken(sessionId);
  let response = await fetch(url, requestInit(accessToken));

  if (response.status === 401) {
    const refreshed = await getValidSpotifyAccessToken(sessionId, true);
    accessToken = refreshed.accessToken;
    response = await fetch(url, requestInit(accessToken));
  }

  if (response.status === 204 || response.status === 202) {
    return null as T | null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Spotify API request failed: ${errorText}`);
  }

  if (options.allowNoContent) {
    return null as T | null;
  }

  return (await response.json()) as T;
}

function normalizePlaybackState(
  playback: SpotifyPlaybackState | null,
): PlaybackDto | null {
  if (!playback) {
    return null;
  }

  return {
    isPlaying: playback.is_playing,
    progressMs: playback.progress_ms ?? 0,
    deviceName: playback.device?.name ?? null,
    volumePercent: playback.device?.volume_percent ?? null,
    context: playback.context
      ? {
          uri: playback.context.uri ?? null,
          type: playback.context.type ?? null,
        }
      : null,
    item: playback.item
      ? {
          name: playback.item.name,
          artists: playback.item.artists.map((artist) => artist.name),
          albumName: playback.item.album.name,
          durationMs: playback.item.duration_ms,
          imageUrl: playback.item.album.images[0]?.url ?? null,
          uri: playback.item.uri,
        }
      : null,
  };
}

async function getPreferredDeviceId(sessionId: string) {
  const connection = await prisma.spotifyConnection.findUnique({
    where: {
      sessionId,
    },
    select: {
      playerDeviceId: true,
    },
  });

  return connection?.playerDeviceId ?? null;
}

export async function getBrowserPlaybackToken(sessionId: string) {
  const { accessToken } = await getValidSpotifyAccessToken(sessionId);
  return accessToken;
}

export async function getCurrentPlaybackState(sessionId: string) {
  const playback = await spotifyApiRequest<SpotifyPlaybackState>(
    sessionId,
    "/me/player",
    {
      query: {
        additional_types: "track",
      },
      allowNoContent: true,
    },
  );

  return normalizePlaybackState(playback);
}

export async function searchTracks(sessionId: string, query: string, limit = 5) {
  const response = await spotifyApiRequest<SpotifyTrackSearchResponse>(
    sessionId,
    "/search",
    {
      query: {
        q: query,
        type: "track",
        limit,
      },
    },
  );

  return (
    response?.tracks.items.map((track) => ({
      name: track.name,
      uri: track.uri,
      artists: track.artists.map((artist) => artist.name),
      albumName: track.album.name,
      durationMs: track.duration_ms,
      imageUrl: track.album.images[0]?.url ?? null,
    })) ?? []
  );
}

export async function searchPlaylists(
  sessionId: string,
  query: string,
  limit = 5,
) {
  const response = await spotifyApiRequest<SpotifyPlaylistSearchResponse>(
    sessionId,
    "/search",
    {
      query: {
        q: query,
        type: "playlist",
        limit,
      },
    },
  );

  const playlists = response?.playlists.items ?? [];

  return Promise.all(
    playlists.map(async (playlist) => ({
      id: playlist.id,
      name: playlist.name,
      uri: playlist.uri,
      description: playlist.description,
      ownerName: playlist.owner.display_name,
      trackCount: playlist.items.total,
      imageUrl:
        playlist.images[0]?.url ??
        (await getPlaylistCoverImage(sessionId, playlist.id).catch(() => null)),
    })),
  );
}

export async function getPlaylistCoverImage(
  sessionId: string,
  playlistId: string,
) {
  const images = await spotifyApiRequest<SpotifyPlaylistCoverImage[]>(
    sessionId,
    `/playlists/${playlistId}/images`,
  );

  return images?.[0]?.url ?? null;
}

export async function playTrackUris(sessionId: string, uris: string[]) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/play", {
    method: "PUT",
    query: {
      device_id: deviceId,
    },
    body: {
      uris,
    },
    allowNoContent: true,
  });
}

export async function playPlaylist(sessionId: string, contextUri: string) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/play", {
    method: "PUT",
    query: {
      device_id: deviceId,
    },
    body: {
      context_uri: contextUri,
    },
    allowNoContent: true,
  });
}

export async function pausePlayback(sessionId: string) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/pause", {
    method: "PUT",
    query: {
      device_id: deviceId,
    },
    allowNoContent: true,
  });
}

export async function resumePlayback(sessionId: string) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/play", {
    method: "PUT",
    query: {
      device_id: deviceId,
    },
    allowNoContent: true,
  });
}

export async function skipToNext(sessionId: string) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/next", {
    method: "POST",
    query: {
      device_id: deviceId,
    },
    allowNoContent: true,
  });
}

export async function skipToPrevious(sessionId: string) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/previous", {
    method: "POST",
    query: {
      device_id: deviceId,
    },
    allowNoContent: true,
  });
}

export async function setVolume(sessionId: string, volumePercent: number) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/volume", {
    method: "PUT",
    query: {
      volume_percent: volumePercent,
      device_id: deviceId,
    },
    allowNoContent: true,
  });
}

export async function queueTrack(sessionId: string, uri: string) {
  const deviceId = await getPreferredDeviceId(sessionId);

  await spotifyApiRequest(sessionId, "/me/player/queue", {
    method: "POST",
    query: {
      uri,
      device_id: deviceId,
    },
    allowNoContent: true,
  });
}

export async function transferPlaybackToDevice(
  sessionId: string,
  deviceId: string,
) {
  await spotifyApiRequest(sessionId, "/me/player", {
    method: "PUT",
    body: {
      device_ids: [deviceId],
      play: false,
    },
    allowNoContent: true,
  });
}

export async function setPreferredPlayerDevice(
  sessionId: string,
  deviceId: string,
) {
  await prisma.spotifyConnection.update({
    where: {
      sessionId,
    },
    data: {
      playerDeviceId: deviceId,
    },
  });

  await transferPlaybackToDevice(sessionId, deviceId);
}
