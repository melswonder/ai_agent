"use client";

import { useEffect, useEffectEvent } from "react";
import type { SdkStatus } from "@/lib/contracts";

type SpotifyWebPlayerBridgeProps = {
  enabled: boolean;
  onSdkStatusChange: (status: SdkStatus) => void;
  onPlaybackPing: () => void;
};

export function SpotifyWebPlayerBridge({
  enabled,
  onSdkStatusChange,
  onPlaybackPing,
}: SpotifyWebPlayerBridgeProps) {
  const emitStatus = useEffectEvent(onSdkStatusChange);
  const emitPlaybackPing = useEffectEvent(onPlaybackPing);

  useEffect(() => {
    if (!enabled) {
      emitStatus({
        connected: false,
        deviceId: null,
        error: null,
      });
      return;
    }

    let disposed = false;
    let player: Spotify.Player | null = null;
    let injectedScript: HTMLScriptElement | null = null;

    const fetchPlaybackToken = async () => {
      const response = await fetch("/api/spotify/token", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Spotify の再生トークンを取得できませんでした。");
      }

      const data = (await response.json()) as { accessToken: string };
      return data.accessToken;
    };

    const mountPlayer = () => {
      if (disposed || !window.Spotify) {
        return;
      }

      player = new window.Spotify.Player({
        name: "Spotify Chat DJ Browser Player",
        volume: 0.72,
        getOAuthToken: async (callback) => {
          try {
            callback(await fetchPlaybackToken());
          } catch (error) {
            emitStatus({
              connected: false,
              deviceId: null,
              error:
                error instanceof Error
                  ? error.message
                  : "Spotify トークンの取得に失敗しました。",
            });
          }
        },
      });

      player.addListener(
        "ready",
        async ({ device_id }: { device_id: string }) => {
        try {
          await fetch("/api/player/device", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              deviceId: device_id,
            }),
          });

          emitStatus({
            connected: true,
            deviceId: device_id,
            error: null,
          });
          emitPlaybackPing();
        } catch (error) {
          emitStatus({
            connected: false,
            deviceId: device_id,
            error:
              error instanceof Error
                ? error.message
                : "ブラウザ再生デバイスの登録に失敗しました。",
          });
        }
        },
      );

      player.addListener("not_ready", ({ device_id }: { device_id: string }) => {
        emitStatus({
          connected: false,
          deviceId: device_id,
          error: "ブラウザの Spotify 再生デバイスがオフラインです。",
        });
      });

      player.addListener("initialization_error", ({ message }: { message: string }) => {
        emitStatus({
          connected: false,
          deviceId: null,
          error: message,
        });
      });

      player.addListener("authentication_error", ({ message }: { message: string }) => {
        emitStatus({
          connected: false,
          deviceId: null,
          error: message,
        });
      });

      player.addListener("account_error", ({ message }: { message: string }) => {
        emitStatus({
          connected: false,
          deviceId: null,
          error: message,
        });
      });

      player.addListener("playback_error", ({ message }: { message: string }) => {
        emitStatus({
          connected: false,
          deviceId: null,
          error: message,
        });
      });

      player.addListener("player_state_changed", () => {
        emitPlaybackPing();
      });

      void player.connect();
    };

    if (window.Spotify) {
      mountPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = mountPlayer;
      injectedScript = document.createElement("script");
      injectedScript.async = true;
      injectedScript.src = "https://sdk.scdn.co/spotify-player.js";
      document.body.appendChild(injectedScript);
    }

    return () => {
      disposed = true;
      window.onSpotifyWebPlaybackSDKReady = undefined;

      if (player) {
        player.disconnect();
      }

      if (injectedScript) {
        injectedScript.remove();
      }
    };
  }, [enabled]);

  return null;
}
