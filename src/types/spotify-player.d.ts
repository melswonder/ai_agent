declare global {
  namespace Spotify {
    type ErrorListener = (payload: { message: string }) => void;
    type ReadyListener = (payload: { device_id: string }) => void;
    type PlayerStateListener = (state: PlaybackState | null) => void;

    interface Album {
      images: { url: string }[];
    }

    interface Artist {
      name: string;
    }

    interface TrackWindow {
      current_track: {
        name: string;
        uri: string;
        album: Album;
        artists: Artist[];
      };
    }

    interface PlaybackState {
      paused: boolean;
      position: number;
      duration: number;
      track_window: TrackWindow;
    }

    interface Player {
      connect(): Promise<boolean>;
      disconnect(): void;
      addListener(
        event:
          | "ready"
          | "not_ready"
          | "player_state_changed"
          | "initialization_error"
          | "authentication_error"
          | "account_error"
          | "playback_error",
        callback:
          | ReadyListener
          | ErrorListener
          | PlayerStateListener,
      ): boolean;
      removeListener(event: string): boolean;
    }

    interface PlayerInit {
      name: string;
      getOAuthToken: (cb: (token: string) => void) => void | Promise<void>;
      volume?: number;
    }
  }

  interface Window {
    Spotify?: {
      Player: new (init: Spotify.PlayerInit) => Spotify.Player;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export {};
