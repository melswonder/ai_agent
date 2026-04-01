import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getCurrentPlaybackState,
  pausePlayback,
  playPlaylist,
  playTrackUris,
  queueTrack,
  resumePlayback,
  searchPlaylists,
  searchTracks,
  setVolume,
  skipToNext,
  skipToPrevious,
} from "@/lib/spotify/client";

export function createSpotifyTools(sessionId: string) {
  return [
    tool(
      async ({ query, limit }) => {
        const tracks = await searchTracks(sessionId, query, limit);
        return JSON.stringify({ tracks }, null, 2);
      },
      {
        name: "search_tracks",
        description:
          "Search Spotify tracks by mood, artist, song name, or natural-language query.",
        schema: z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(10).optional().default(5),
        }),
      },
    ),
    tool(
      async ({ query, limit }) => {
        const playlists = await searchPlaylists(sessionId, query, limit);
        return JSON.stringify({ playlists }, null, 2);
      },
      {
        name: "search_playlists",
        description:
          "Search Spotify playlists when the user asks for a vibe or a themed playlist.",
        schema: z.object({
          query: z.string().min(1),
          limit: z.number().int().min(1).max(10).optional().default(5),
        }),
      },
    ),
    tool(
      async ({ uris }) => {
        await playTrackUris(sessionId, uris);
        return JSON.stringify({
          ok: true,
          action: "play_tracks",
          uris,
        });
      },
      {
        name: "play_tracks",
        description:
          "Start playback for one or more Spotify track URIs on the user's current device.",
        schema: z.object({
          uris: z.array(z.string().min(1)).min(1).max(10),
        }),
      },
    ),
    tool(
      async ({ contextUri }) => {
        await playPlaylist(sessionId, contextUri);
        return JSON.stringify({
          ok: true,
          action: "play_playlist",
          contextUri,
        });
      },
      {
        name: "play_playlist",
        description: "Play a Spotify playlist by its context URI.",
        schema: z.object({
          contextUri: z.string().startsWith("spotify:playlist:"),
        }),
      },
    ),
    tool(
      async () => {
        await pausePlayback(sessionId);
        return JSON.stringify({
          ok: true,
          action: "pause_playback",
        });
      },
      {
        name: "pause_playback",
        description: "Pause Spotify playback.",
        schema: z.object({}),
      },
    ),
    tool(
      async () => {
        await resumePlayback(sessionId);
        return JSON.stringify({
          ok: true,
          action: "resume_playback",
        });
      },
      {
        name: "resume_playback",
        description: "Resume Spotify playback.",
        schema: z.object({}),
      },
    ),
    tool(
      async () => {
        await skipToNext(sessionId);
        return JSON.stringify({
          ok: true,
          action: "skip_to_next",
        });
      },
      {
        name: "skip_to_next",
        description: "Skip to the next Spotify track.",
        schema: z.object({}),
      },
    ),
    tool(
      async () => {
        await skipToPrevious(sessionId);
        return JSON.stringify({
          ok: true,
          action: "skip_to_previous",
        });
      },
      {
        name: "skip_to_previous",
        description: "Return to the previous Spotify track.",
        schema: z.object({}),
      },
    ),
    tool(
      async ({ volumePercent }) => {
        await setVolume(sessionId, volumePercent);
        return JSON.stringify({
          ok: true,
          action: "set_volume",
          volumePercent,
        });
      },
      {
        name: "set_volume",
        description: "Set the current Spotify device volume from 0 to 100.",
        schema: z.object({
          volumePercent: z.number().int().min(0).max(100),
        }),
      },
    ),
    tool(
      async ({ uri }) => {
        await queueTrack(sessionId, uri);
        return JSON.stringify({
          ok: true,
          action: "queue_track",
          uri,
        });
      },
      {
        name: "queue_track",
        description: "Queue a Spotify track URI after the current item.",
        schema: z.object({
          uri: z.string().startsWith("spotify:track:"),
        }),
      },
    ),
    tool(
      async () => {
        const playback = await getCurrentPlaybackState(sessionId);
        return JSON.stringify(
          {
            playback,
          },
          null,
          2,
        );
      },
      {
        name: "get_current_playback",
        description:
          "Read the current Spotify playback state before deciding how to change the music.",
        schema: z.object({}),
      },
    ),
  ];
}
