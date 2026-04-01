"use client";

import clsx from "clsx";
import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type FormEvent,
} from "react";
import {
  Activity,
  Bot,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Loader2,
  MoreHorizontal,
  Music,
  Send,
  Trash2,
  User,
  Volume2,
  X,
  Zap,
} from "lucide-react";
import type {
  ChatResponseDto,
  PlaybackDto,
  SdkStatus,
  SessionDto,
  SpotifyConfigDto,
} from "@/lib/contracts";
import { SpotifyWebPlayerBridge } from "@/components/spotify-web-player-bridge";

const EMPTY_SESSION: SessionDto = {
  authenticated: false,
  spotifyConfigured: false,
  llmConfigured: false,
  deviceReady: false,
  callbackUrl: "https://127.0.0.1:8000/callbacks",
  profile: null,
  messages: [],
  playback: null,
};

const EXAMPLE_PROMPTS = [
  "夜のドライブ向けに、もう少し高揚感のある曲にして",
  "この流れのまま少し落ち着いたテンポへ",
  "今の曲に近い雰囲気でプレイリストに切り替えて",
];

const QUICK_ACTIONS = [
  {
    label: "Mood",
    icon: Zap,
    prompt: EXAMPLE_PROMPTS[0],
  },
  {
    label: "Playback",
    icon: Music,
    prompt: "今の曲に近い雰囲気で次の曲へつないで",
  },
  {
    label: "Volume",
    icon: Volume2,
    prompt: "音量を55にして、少しだけ落ち着いた流れにして",
  },
];

async function fetchSessionState() {
  const response = await fetch("/api/session", {
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await readErrorText(response);
    throw new Error(message || "セッション状態の取得に失敗しました。");
  }

  return (await response.json()) as SessionDto;
}

async function fetchPlaybackState() {
  const response = await fetch("/api/playback", {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as {
    playback: PlaybackDto | null;
    deviceReady: boolean;
  };
}

async function fetchSpotifyConfig() {
  const response = await fetch("/api/config/spotify", {
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await readErrorText(response);
    throw new Error(message || "Spotify 設定の取得に失敗しました。");
  }

  return (await response.json()) as SpotifyConfigDto;
}

async function updateSpotifyConfig(payload: {
  clientId: string;
  clientSecret: string;
}) {
  const response = await fetch("/api/config/spotify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await readErrorText(response);
    throw new Error(message || "Spotify 設定の保存に失敗しました。");
  }

  return (await response.json()) as SpotifyConfigDto;
}

async function readErrorText(response: Response) {
  const text = await response.text();
  return text.startsWith("{") ? text : text.trim();
}

function authErrorMessage(code: string | null) {
  if (!code) {
    return null;
  }

  switch (code) {
    case "access_denied":
      return "Spotify 側で接続がキャンセルされました。";
    case "oauth_state_invalid":
      return "Spotify 認証の state 検証に失敗しました。再接続してください。";
    case "token_exchange_failed":
      return "Spotify の token 交換に失敗しました。client 設定を確認してください。";
    case "spotify_config_missing":
      return "Spotify 認証情報がサーバーに設定されていません。";
    default:
      return `Spotify 認証でエラーが発生しました: ${code}`;
  }
}

function formatClock(isoDate: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(isoDate));
}

function formatDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clampProgress(progressMs: number, durationMs: number | null | undefined) {
  if (!durationMs || durationMs <= 0) {
    return Math.max(0, progressMs);
  }

  return Math.min(durationMs, Math.max(0, progressMs));
}

function progressWidth(progressMs: number, durationMs: number | null | undefined) {
  if (!durationMs || durationMs <= 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(6, (clampProgress(progressMs, durationMs) / Math.max(durationMs, 1)) * 100),
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-100 py-3 last:border-b-0 last:pb-0">
      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
        {label}
      </span>
      <span className="max-w-[60%] break-all text-right text-sm leading-6 text-zinc-600">
        {value}
      </span>
    </div>
  );
}

function SpotifyLogo({
  className,
  alt = "Spotify",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <Image
      src="/assets/spotify-full-logo-green.png"
      alt={alt}
      width={823}
      height={225}
      className={className}
      priority={false}
    />
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "offline";
}) {
  const toneClasses =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-zinc-200 bg-zinc-100 text-zinc-500";

  const dotClasses =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "warning"
        ? "bg-amber-500"
        : "bg-zinc-400";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em]",
        toneClasses,
      )}
    >
      <span className={clsx("h-2 w-2 rounded-full", dotClasses)} />
      {label}
    </span>
  );
}

function NowPlayingDrawer({
  authenticated,
  displayName,
  sdkConnected,
  isOpen,
  onToggle,
  currentTrack,
  playback,
}: {
  authenticated: boolean;
  displayName: string | null | undefined;
  sdkConnected: boolean;
  isOpen: boolean;
  onToggle: () => void;
  currentTrack: PlaybackDto["item"] | null;
  playback: PlaybackDto | null;
}) {
  const [clockMs, setClockMs] = useState(() => Date.now());
  const [progressBaseline, setProgressBaseline] = useState(() => ({
    signature: "",
    capturedAt: Date.now(),
  }));

  const progressSignature = [
    currentTrack?.uri ?? "none",
    playback?.progressMs ?? 0,
    playback?.isPlaying ? "1" : "0",
  ].join(":");

  useEffect(() => {
    const capturedAt = Date.now();

    const frameId = window.requestAnimationFrame(() => {
      setProgressBaseline({
        signature: progressSignature,
        capturedAt,
      });
      setClockMs(capturedAt);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [progressSignature]);

  useEffect(() => {
    if (!playback?.isPlaying || !currentTrack?.durationMs) {
      return;
    }

    const timer = window.setInterval(() => {
      setClockMs(Date.now());
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [playback?.isPlaying, currentTrack?.uri, currentTrack?.durationMs]);

  const elapsedMs = playback?.isPlaying
    ? Math.max(0, clockMs - progressBaseline.capturedAt)
    : 0;
  const displayProgressMs = clampProgress(
    (playback?.progressMs ?? 0) + elapsedMs,
    currentTrack?.durationMs,
  );
  const playbackStatus = playback?.isPlaying ? "Playing" : "Idle";
  const deviceLabel = playback?.deviceName
    ? playback.deviceName
    : authenticated
      ? "Browser standby"
      : "Not connected";
  const accountLabel = authenticated
    ? displayName ?? "Connected account"
    : "Spotify not connected";
  const volumeLabel =
    playback?.volumePercent != null ? `${playback.volumePercent}%` : "--";
  const contextLabel = playback?.context?.type
    ? playback.context.type.toUpperCase()
    : "TRACK";
  const artistsLabel =
    currentTrack && currentTrack.artists.length > 0
      ? currentTrack.artists.join(", ")
      : "Unavailable";
  const sourceLabel =
    currentTrack?.uri ??
    playback?.context?.uri ??
    "Playback metadata will appear here after Spotify starts playing.";

  return (
    <div className="pointer-events-none absolute right-0 top-6 z-30 hidden lg:block">
      <div
        className={clsx(
          "pointer-events-auto flex items-start transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-[24rem]",
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className="mt-4 flex items-center gap-2 rounded-l-2xl border border-r-0 border-zinc-200 bg-white px-3 py-3 text-zinc-500 shadow-[0_18px_50px_rgba(24,24,27,0.08)] transition hover:text-zinc-900"
          aria-label={isOpen ? "Hide now playing panel" : "Show now playing panel"}
        >
          <Music className="h-4 w-4" />
          <span className="text-[10px] font-black uppercase tracking-[0.18em]">
            Now Playing
          </span>
          {isOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        <aside className="flex h-[calc(100dvh-7rem)] w-[24rem] flex-col overflow-hidden rounded-l-[1.75rem] border border-r-0 border-zinc-200 bg-white shadow-[0_28px_80px_rgba(24,24,27,0.12)]">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-2">
                <Music className="h-4 w-4 text-zinc-500" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                  Now Playing
                </p>
                <p className="mt-2 text-sm font-semibold text-zinc-900">
                  {currentTrack ? currentTrack.name : "No active playback"}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-zinc-300">
              {playback?.isPlaying ? "LIVE" : "IDLE"}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="rounded-[1.5rem] border border-zinc-200 bg-zinc-50/60 p-4">
              {currentTrack?.imageUrl ? (
                <Image
                  src={currentTrack.imageUrl}
                  alt={currentTrack.name}
                  width={720}
                  height={720}
                  className="h-64 w-full rounded-[1.25rem] object-cover"
                />
              ) : (
                <div className="flex h-64 items-center justify-center rounded-[1.25rem] border border-zinc-100 bg-white text-sm text-zinc-400">
                  Artwork unavailable
                </div>
              )}

              <div className="mt-4">
                <p className="text-lg font-semibold leading-8 text-zinc-900">
                  {currentTrack ? currentTrack.name : "Playback will appear here"}
                </p>
                <p className="mt-2 text-sm leading-7 text-zinc-500">
                  {currentTrack
                    ? artistsLabel
                    : "Spotify の再生が始まると、曲情報とジャケット画像をこのパネルに表示します。"}
                </p>
                <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300">
                  {currentTrack?.albumName ?? "Spotify metadata"}
                </p>
              </div>

              <div className="mt-5">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                  <span>{playbackStatus}</span>
                  <span>{contextLabel}</span>
                </div>
                <div className="mt-3 h-2 rounded-full bg-zinc-100">
                  <div
                    className="h-2 rounded-full bg-zinc-900 transition-[width] duration-200"
                    style={{
                      width: `${progressWidth(
                        displayProgressMs,
                        currentTrack?.durationMs,
                      )}%`,
                    }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.16em] text-zinc-300">
                  <span>{formatDuration(displayProgressMs)}</span>
                  <span>{formatDuration(currentTrack?.durationMs ?? 0)}</span>
                </div>
              </div>
            </div>

            <section className="mt-5 rounded-[1.5rem] border border-zinc-200 bg-white px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                Session Details
              </p>
              <div className="mt-3">
                <DetailRow label="Account" value={accountLabel} />
                <DetailRow label="Device" value={deviceLabel} />
                <DetailRow label="SDK" value={sdkConnected ? "Connected" : "Offline"} />
                <DetailRow label="Volume" value={volumeLabel} />
              </div>
            </section>

            <section className="mt-5 rounded-[1.5rem] border border-zinc-200 bg-white px-4 py-3">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                Track Details
              </p>
              <div className="mt-3">
                <DetailRow label="Album" value={currentTrack?.albumName ?? "Unavailable"} />
                <DetailRow label="Artists" value={artistsLabel} />
                <DetailRow label="Source" value={sourceLabel} />
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SettingsPanel({
  authenticated,
  displayName,
  llmConfigured,
  deviceReady,
  sdkConnected,
  spotifyConfig,
  isSpotifyConfigLoading,
  isSpotifyConfigSaving,
  spotifyConfigError,
  onSpotifyConfigChange,
  onSpotifyConfigSave,
  onLogin,
  onClose,
  onLogout,
}: {
  authenticated: boolean;
  displayName: string | null | undefined;
  llmConfigured: boolean;
  deviceReady: boolean;
  sdkConnected: boolean;
  spotifyConfig: SpotifyConfigDto | null;
  isSpotifyConfigLoading: boolean;
  isSpotifyConfigSaving: boolean;
  spotifyConfigError: string | null;
  onSpotifyConfigChange: (
    field: "clientId" | "clientSecret",
    value: string,
  ) => void;
  onSpotifyConfigSave: () => void;
  onLogin: () => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close settings"
        className="absolute inset-0 bg-zinc-900/18 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <aside className="absolute right-0 top-0 h-full w-full max-w-md border-l border-zinc-200 bg-white shadow-[0_24px_80px_rgba(24,24,27,0.12)]">
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                Settings
              </p>
              <p className="mt-2 text-sm font-semibold text-zinc-900">
                Spotify Control Settings
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-zinc-200 p-2 text-zinc-500 transition-colors hover:border-zinc-400 hover:text-zinc-900"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            <section className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2.5">
                  <SpotifyLogo className="h-6 w-auto" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                    Spotify Account
                  </p>
                  <p className="mt-2 text-sm font-semibold text-zinc-900">
                    {authenticated ? displayName ?? "Connected Account" : "Not connected"}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={onLogin}
                  disabled={!spotifyConfig?.configured || isSpotifyConfigSaving}
                  className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  <SpotifyLogo className="h-4 w-auto" alt="" />
                  Connect
                </button>

                <button
                  type="button"
                  onClick={onLogout}
                  disabled={!authenticated}
                  className="rounded-xl border border-zinc-200 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 transition-colors hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  Disconnect
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {isSpotifyConfigLoading ? (
                  <p className="text-sm leading-6 text-zinc-500">
                    Spotify 設定を読み込み中です...
                  </p>
                ) : null}

                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                    Client ID
                  </span>
                  <input
                    type="text"
                    value={spotifyConfig?.clientId ?? ""}
                    disabled={isSpotifyConfigLoading || isSpotifyConfigSaving}
                    onChange={(event) =>
                      onSpotifyConfigChange("clientId", event.target.value)
                    }
                    placeholder="Spotify client id"
                    className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-300 focus:border-zinc-400 focus:outline-none"
                  />
                </label>

                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-400">
                    Client Secret
                  </span>
                  <input
                    type="password"
                    value={spotifyConfig?.clientSecret ?? ""}
                    disabled={isSpotifyConfigLoading || isSpotifyConfigSaving}
                    onChange={(event) =>
                      onSpotifyConfigChange("clientSecret", event.target.value)
                    }
                    placeholder="Spotify client secret"
                    className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-300 focus:border-zinc-400 focus:outline-none"
                  />
                </label>

                {spotifyConfigError ? (
                  <p className="text-sm leading-6 text-rose-600">{spotifyConfigError}</p>
                ) : null}

                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs leading-6 text-zinc-500">
                    `.env.local` に保存します。secret は入力欄では見えません。
                  </p>
                  <button
                    type="button"
                    onClick={onSpotifyConfigSave}
                    disabled={isSpotifyConfigLoading || isSpotifyConfigSaving}
                    className="shrink-0 rounded-xl border border-zinc-200 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-700 transition-colors hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {isSpotifyConfigSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-zinc-400">
                Runtime Status
              </p>
              <div className="mt-4 space-y-3 text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                <div className="flex items-center justify-between">
                  <span>OAuth</span>
                  <StatusPill
                    label={authenticated ? "READY" : "WAITING"}
                    tone={authenticated ? "success" : "warning"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>LLM Agent</span>
                  <StatusPill
                    label={llmConfigured ? "ARMED" : "LOCKED"}
                    tone={llmConfigured ? "success" : "warning"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Browser Device</span>
                  <StatusPill
                    label={deviceReady ? "ONLINE" : "PENDING"}
                    tone={deviceReady ? "success" : "warning"}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span>Web SDK</span>
                  <StatusPill
                    label={sdkConnected ? "SYNCED" : "OFFLINE"}
                    tone={sdkConnected ? "success" : "offline"}
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function HomeShell({
  initialAuthError,
}: {
  initialAuthError: string | null;
}) {
  const hasMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [session, setSession] = useState<SessionDto>(EMPTY_SESSION);
  const [sdkStatus, setSdkStatus] = useState<SdkStatus>({
    connected: false,
    deviceId: null,
    error: null,
  });
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(
    authErrorMessage(initialAuthError),
  );
  const [isPending, startTransition] = useTransition();
  const [isClearingHistory, startClearingHistory] = useTransition();
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(true);
  const [spotifyConfig, setSpotifyConfig] = useState<SpotifyConfigDto | null>(null);
  const [isSpotifyConfigLoading, setIsSpotifyConfigLoading] = useState(false);
  const [isSpotifyConfigSaving, setIsSpotifyConfigSaving] = useState(false);
  const [spotifyConfigError, setSpotifyConfigError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await fetchSessionState();

        if (!cancelled) {
          setSession(data);
        }
      } catch (error) {
        console.error(error);

        if (!cancelled) {
          setNotice("初期状態を取得できませんでした。");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session.authenticated) {
      return;
    }

    let cancelled = false;

    const syncPlayback = async () => {
      try {
        const data = await fetchPlaybackState();

        if (!cancelled && data) {
          setSession((current) => ({
            ...current,
            playback: data.playback,
            deviceReady: data.deviceReady,
          }));
        }
      } catch (error) {
        console.error(error);
      }
    };

    void syncPlayback();
    const timer = window.setInterval(() => {
      void syncPlayback();
    }, 9000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session.authenticated]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [session.messages, isPending]);

  let composerReason: string | null = null;

  if (!session.spotifyConfigured) {
    composerReason = "Spotify の client 設定がまだサーバーにありません。";
  } else if (!session.authenticated) {
    composerReason = "Spotify に接続するとチャットから再生を変えられます。";
  } else if (!session.llmConfigured) {
    composerReason = "OPENAI_API_KEY を設定すると LangGraph エージェントが動きます。";
  } else if (!session.deviceReady) {
    composerReason =
      "ブラウザの Spotify 再生デバイスを準備中です。数秒待って再試行してください。";
  }

  const currentTrack = session.playback?.item ?? null;
  const isBusy = isPending || isClearingHistory;
  const visibleMessages = session.messages;

  function handlePromptClick(prompt: string) {
    setDraft(prompt);
  }

  async function loadSpotifyConfig() {
    setIsSpotifyConfigLoading(true);
    setSpotifyConfigError(null);

    try {
      const data = await fetchSpotifyConfig();
      setSpotifyConfig(data);
    } catch (error) {
      console.error(error);
      setSpotifyConfigError("Spotify 設定を読み込めませんでした。");
    } finally {
      setIsSpotifyConfigLoading(false);
    }
  }

  function handleOpenSettings() {
    setIsSettingsOpen(true);
    void loadSpotifyConfig();
  }

  function handleSpotifyConfigChange(
    field: "clientId" | "clientSecret",
    value: string,
  ) {
    setSpotifyConfig((current) => {
      const next = current ?? {
        clientId: "",
        clientSecret: "",
        configured: false,
      };
      const updated = {
        ...next,
        [field]: value,
      };

      return {
        ...updated,
        configured: Boolean(
          updated.clientId.trim() && updated.clientSecret.trim(),
        ),
      };
    });
    setSpotifyConfigError(null);
  }

  async function handleSpotifyConfigSave() {
    const payload = {
      clientId: spotifyConfig?.clientId ?? "",
      clientSecret: spotifyConfig?.clientSecret ?? "",
    };

    setIsSpotifyConfigSaving(true);
    setSpotifyConfigError(null);

    try {
      const data = await updateSpotifyConfig(payload);
      setSpotifyConfig(data);
      setNotice("Spotify の client 設定を保存しました。");
      await reloadSessionFromServer();
    } catch (error) {
      console.error(error);
      setSpotifyConfigError("Spotify 設定の保存に失敗しました。");
    } finally {
      setIsSpotifyConfigSaving(false);
    }
  }

  function handleSpotifyLogin() {
    if (!spotifyConfig?.configured) {
      setSpotifyConfigError(
        "Connect の前に client id と client secret を保存してください。",
      );
      return;
    }

    window.location.href = "/api/auth/spotify/login";
  }

  async function reloadSessionFromServer() {
    try {
      const data = await fetchSessionState();
      setSession(data);
    } catch (error) {
      console.error(error);
      setNotice("状態の再読込に失敗しました。");
    }
  }

  async function reloadPlaybackFromServer() {
    try {
      const data = await fetchPlaybackState();

      if (!data) {
        return;
      }

      setSession((current) => ({
        ...current,
        playback: data.playback,
        deviceReady: data.deviceReady,
      }));
    } catch (error) {
      console.error(error);
    }
  }

  function handleLogout() {
    startTransition(() => {
      void (async () => {
        await fetch("/api/auth/logout", {
          method: "POST",
        });
        setSdkStatus({
          connected: false,
          deviceId: null,
          error: null,
        });
        setIsSettingsOpen(false);
        setNotice("Spotify の接続を解除しました。");
        await reloadSessionFromServer();
      })();
    });
  }

  function handleClearHistory() {
    if (visibleMessages.length === 0 || isBusy) {
      return;
    }

    const shouldClear = window.confirm(
      "このブラウザセッションのチャット履歴を削除しますか？",
    );

    if (!shouldClear) {
      return;
    }

    startClearingHistory(() => {
      void (async () => {
        try {
          const response = await fetch("/api/chat/history", {
            method: "DELETE",
          });
          const data = response.ok
            ? ((await response.json()) as {
                ok?: boolean;
                error?: string;
              })
            : ({
                error: await readErrorText(response),
              } as {
                ok?: boolean;
                error?: string;
              });

          if (!response.ok || !data.ok) {
            setNotice(data.error ?? "履歴の削除に失敗しました。");
            return;
          }

          setSession((current) => ({
            ...current,
            messages: [],
          }));
          setNotice("チャット履歴を削除しました。");
        } catch (error) {
          console.error(error);
          setNotice("履歴削除中にネットワークエラーが発生しました。");
        }
      })();
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const message = draft.trim();

    if (!message) {
      return;
    }

    if (composerReason) {
      setNotice(composerReason);
      return;
    }

    const optimisticMessage = {
      id: `optimistic-${Date.now()}`,
      role: "user" as const,
      content: message,
      createdAt: new Date().toISOString(),
    };

    setDraft("");
    setNotice(null);
    setSession((current) => ({
      ...current,
      messages: [...current.messages, optimisticMessage],
    }));

    startTransition(() => {
      void (async () => {
        try {
          const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message,
            }),
          });
          const data = response.ok
            ? ((await response.json()) as ChatResponseDto | { error?: string })
            : ({
                error: await readErrorText(response),
              } as ChatResponseDto | { error?: string });

          if (!response.ok) {
            setNotice(
              "error" in data && data.error
                ? data.error
                : "チャットの実行に失敗しました。",
            );
            await reloadSessionFromServer();
            return;
          }

          const payload = data as ChatResponseDto;

          setSession((current) => ({
            ...current,
            messages: payload.messages,
            playback: payload.playback,
          }));
        } catch (error) {
          console.error(error);
          setNotice("チャット送信中にネットワークエラーが発生しました。");
          await reloadSessionFromServer();
        }
      })();
    });
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-white text-zinc-600">
      <SpotifyWebPlayerBridge
        enabled={session.authenticated}
        onSdkStatusChange={(status) => {
          setSdkStatus(status);
          setSession((current) => ({
            ...current,
            deviceReady: status.connected,
          }));

          if (status.error) {
            setNotice(status.error);
          }
        }}
        onPlaybackPing={() => {
          void reloadPlaybackFromServer();
        }}
      />

      <nav className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-100 bg-white px-4 md:px-6">
        <div className="flex items-center gap-4">
          <div className="rounded bg-zinc-900 p-1.5 shadow-sm">
            <Cpu className="h-4 w-4 text-white" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-900">
            AI Administration Portal
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleClearHistory}
            disabled={visibleMessages.length === 0 || isBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear History</span>
          </button>

          <button
            type="button"
            onClick={handleOpenSettings}
            className="inline-flex items-center justify-center rounded-xl border border-zinc-200 p-2.5 text-zinc-400 transition-colors hover:border-zinc-400 hover:text-zinc-900"
            aria-label="Open settings"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </nav>

      <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {hasMounted ? (
          <NowPlayingDrawer
            authenticated={session.authenticated}
            displayName={session.profile?.displayName}
            sdkConnected={sdkStatus.connected}
            isOpen={isNowPlayingOpen}
            onToggle={() => setIsNowPlayingOpen((current) => !current)}
            currentTrack={currentTrack}
            playback={session.playback}
          />
        ) : null}

        <div
          ref={scrollRef}
          className={clsx(
            "no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-36 pt-8 md:px-6 md:pb-40 md:pt-10 lg:transition-[padding] lg:duration-300",
            hasMounted && isNowPlayingOpen ? "lg:pr-[27rem]" : "lg:pr-20",
          )}
        >
          <div className="mx-auto max-w-3xl space-y-8">
            {notice ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-7 text-zinc-700">
                {notice}
              </div>
            ) : null}

            <div className="space-y-12">
              {visibleMessages.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/60 px-5 py-8 text-center">
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                    Awaiting First Command
                  </p>
                  <p className="mt-4 text-sm leading-7 text-zinc-500">
                    ここには最初の案内メッセージを出さず、会話が始まってから履歴を表示します。
                    好きな作品名や気分をそのまま送ってください。
                  </p>
                </div>
              ) : (
                visibleMessages.map((message, index) => {
                  const isUser = message.role === "user";
                  const isLastBot =
                    !isUser && index === visibleMessages.length - 1 && !isPending;

                  return (
                    <div
                      key={message.id}
                      className={clsx(
                        "fade-up flex",
                        isUser ? "justify-end" : "justify-start",
                      )}
                    >
                      <div
                        className={clsx(
                          "flex max-w-[92%] gap-5 md:max-w-[88%]",
                          isUser ? "flex-row-reverse" : "",
                        )}
                      >
                        <div
                          className={clsx(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                            isUser
                              ? "border-zinc-900 bg-zinc-900 shadow-sm"
                              : "border-zinc-100 bg-white",
                          )}
                        >
                          {isUser ? (
                            <User className="h-5 w-5 text-white" />
                          ) : (
                            <Bot className="h-5 w-5 text-zinc-400" />
                          )}
                        </div>

                        <div
                          className={clsx(
                            "py-1.5",
                            isUser ? "text-right" : "text-left",
                          )}
                        >
                          <p
                            className={clsx(
                              "whitespace-pre-wrap text-[15px] leading-relaxed tracking-[0.01em]",
                              isUser
                                ? "font-medium text-zinc-900"
                                : "text-zinc-600",
                            )}
                          >
                            {message.content}
                          </p>

                          <div
                            className={clsx(
                              "mt-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]",
                              isUser
                                ? "justify-end text-zinc-300"
                                : "justify-start text-zinc-300",
                            )}
                          >
                            <span>{formatClock(message.createdAt)}</span>
                            {!isUser ? <span>assistant</span> : null}
                          </div>

                          {isLastBot ? (
                            <div className="mt-4 flex items-center gap-2 text-[10px] italic text-zinc-300">
                              <div className="h-px w-8 bg-zinc-100" />
                              <span>Received via Spotify Control Plane</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              {isBusy ? (
                <div className="flex items-center gap-5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50">
                    <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-2 w-32 rounded-full bg-zinc-100" />
                    <div className="h-2 w-20 rounded-full bg-zinc-50" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className={clsx(
            "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/96 to-transparent px-4 pb-8 pt-20 md:px-6 lg:transition-[padding] lg:duration-300",
            hasMounted && isNowPlayingOpen ? "lg:pr-[27rem]" : "lg:pr-20",
          )}
        >
          <div className="pointer-events-auto mx-auto max-w-3xl">
            <form
              onSubmit={handleSubmit}
              className="overflow-hidden rounded-[1.4rem] border border-zinc-200 bg-white shadow-[0_24px_70px_rgba(24,24,27,0.08)]"
            >
              <div className="flex items-center px-5 py-4 md:px-6">
                <input
                  type="text"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="AIコンシェルジュに指示を送信..."
                  className="flex-1 bg-transparent py-2 text-sm tracking-[0.02em] text-zinc-900 placeholder:font-medium placeholder:text-zinc-300 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isBusy}
                  className="ml-4 rounded-xl bg-zinc-900 p-2.5 text-white shadow-sm transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-20"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>

              <div className="no-scrollbar flex items-center gap-5 overflow-x-auto border-t border-zinc-100 bg-zinc-50/70 px-5 py-3 md:px-6">
                {QUICK_ACTIONS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => handlePromptClick(item.prompt)}
                    className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400 transition hover:text-zinc-900"
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                ))}

                <div className="ml-auto flex items-center gap-4 text-zinc-300">
                  <div className="h-3 w-px bg-zinc-200" />
                  <Activity className="h-3.5 w-3.5" />
                </div>
              </div>
            </form>
          </div>
        </div>
      </main>

      {isSettingsOpen ? (
        <SettingsPanel
          authenticated={session.authenticated}
          displayName={session.profile?.displayName}
          llmConfigured={session.llmConfigured}
          deviceReady={session.deviceReady}
          sdkConnected={sdkStatus.connected}
          spotifyConfig={spotifyConfig}
          isSpotifyConfigLoading={isSpotifyConfigLoading}
          isSpotifyConfigSaving={isSpotifyConfigSaving}
          spotifyConfigError={spotifyConfigError}
          onSpotifyConfigChange={handleSpotifyConfigChange}
          onSpotifyConfigSave={handleSpotifyConfigSave}
          onLogin={handleSpotifyLogin}
          onClose={() => setIsSettingsOpen(false)}
          onLogout={handleLogout}
        />
      ) : null}
    </div>
  );
}
