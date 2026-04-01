"use client";

import clsx from "clsx";
import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  Activity,
  Bot,
  Cpu,
  Loader2,
  MoreHorizontal,
  Music,
  Radio,
  Send,
  Trash2,
  User,
  Volume2,
  Zap,
} from "lucide-react";
import type {
  ChatResponseDto,
  PlaybackDto,
  SdkStatus,
  SessionDto,
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

function progressWidth(playback: PlaybackDto | null) {
  if (!playback?.item) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(6, (playback.progressMs / Math.max(playback.item.durationMs, 1)) * 100),
  );
}

function statusLabel({
  booting,
  isPending,
}: {
  booting: boolean;
  isPending: boolean;
}) {
  if (booting) {
    return "BOOTING";
  }

  if (isPending) {
    return "EXECUTING";
  }

  return "STANDBY";
}

function NowPlayingPanel({
  currentTrack,
  playback,
}: {
  currentTrack: PlaybackDto["item"] | null;
  playback: PlaybackDto | null;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_18px_60px_rgba(24,24,27,0.05)]">
      <div className="flex items-center justify-between">
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

      <div className="mt-4 flex gap-3">
        {currentTrack?.imageUrl ? (
          <Image
            src={currentTrack.imageUrl}
            alt={currentTrack.name}
            width={160}
            height={160}
            className="h-20 w-20 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-zinc-100 bg-zinc-50 text-xs text-zinc-400">
            Cover
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm leading-6 text-zinc-500">
            {currentTrack
              ? currentTrack.artists.join(", ")
              : "再生が始まるとジャケット画像と曲名をここに表示します。"}
          </p>
          <p className="mt-2 line-clamp-2 text-xs uppercase tracking-[0.18em] text-zinc-300">
            {currentTrack?.albumName ?? "Spotify metadata"}
          </p>
          {currentTrack ? (
            <div className="mt-3">
              <div className="h-1.5 rounded-full bg-zinc-100">
                <div
                  className="h-1.5 rounded-full bg-zinc-900"
                  style={{ width: `${progressWidth(playback)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.16em] text-zinc-300">
                <span>{formatDuration(playback?.progressMs ?? 0)}</span>
                <span>{formatDuration(currentTrack.durationMs)}</span>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function HomeShell({
  initialAuthError,
}: {
  initialAuthError: string | null;
}) {
  const [hasMounted, setHasMounted] = useState(false);
  const [session, setSession] = useState<SessionDto>(EMPTY_SESSION);
  const [sdkStatus, setSdkStatus] = useState<SdkStatus>({
    connected: false,
    deviceId: null,
    error: null,
  });
  const [draft, setDraft] = useState("");
  const [booting, setBooting] = useState(true);
  const [notice, setNotice] = useState<string | null>(
    authErrorMessage(initialAuthError),
  );
  const [isPending, startTransition] = useTransition();
  const [isClearingHistory, startClearingHistory] = useTransition();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHasMounted(true);
  }, []);

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
      } finally {
        if (!cancelled) {
          setBooting(false);
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
  const operationState = statusLabel({ booting, isPending: isBusy });
  const visibleMessages = session.messages;

  function handlePromptClick(prompt: string) {
    setDraft(prompt);
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
        setSession(EMPTY_SESSION);
        setSdkStatus({
          connected: false,
          deviceId: null,
          error: null,
        });
        setNotice("Spotify の接続を解除しました。");
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
          const data = (await response.json()) as {
            ok?: boolean;
            error?: string;
          };

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
          const data = (await response.json()) as
            | ChatResponseDto
            | { error?: string };

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
    <div className="min-h-screen bg-white text-zinc-600">
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
          <div className="hidden h-4 w-px bg-zinc-100 md:block" />
          <span className="hidden items-center gap-2 text-[9px] font-bold text-zinc-400 md:inline-flex">
            <span
              className={clsx(
                "h-1.5 w-1.5 rounded-full",
                operationState === "EXECUTING"
                  ? "animate-pulse bg-zinc-900"
                  : "bg-zinc-300",
              )}
            />
            {operationState}
          </span>
        </div>

        <div className="flex items-center gap-2 md:gap-6">
          <div className="hidden gap-4 text-[9px] font-mono text-zinc-400 md:flex">
            <span>PING: 4ms</span>
            <span>NODE: SP-01</span>
            <span>{session.authenticated ? "SPOTIFY: LINKED" : "SPOTIFY: OPEN"}</span>
          </div>

          <button
            type="button"
            onClick={handleClearHistory}
            disabled={visibleMessages.length === 0 || isBusy}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Clear History</span>
          </button>

          {session.authenticated ? (
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl border border-zinc-200 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"
            >
              Disconnect
            </button>
          ) : (
            <a
              href="/api/auth/spotify/login"
              className="rounded-xl bg-zinc-900 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-white hover:bg-zinc-800"
            >
              Connect Spotify
            </a>
          )}

          <MoreHorizontal className="h-4 w-4 cursor-pointer text-zinc-300 transition-colors hover:text-zinc-900" />
        </div>
      </nav>

      <main className="relative flex flex-1 flex-col overflow-hidden">
        {hasMounted ? (
          <div className="pointer-events-none absolute left-4 top-6 hidden w-72 2xl:block">
            <NowPlayingPanel currentTrack={currentTrack} playback={session.playback} />
          </div>
        ) : null}

        <div
          ref={scrollRef}
          className="no-scrollbar flex-1 overflow-y-auto px-4 pb-36 pt-8 md:px-6 md:pb-40 md:pt-10"
        >
          <div className="mx-auto max-w-3xl space-y-8">
            <div className="2xl:hidden">
              <NowPlayingPanel currentTrack={currentTrack} playback={session.playback} />
            </div>

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

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/96 to-transparent px-4 pb-8 pt-20 md:px-6">
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

            <div className="mt-4 flex flex-col gap-2 text-center">
              <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-300">
                Operational Integrity Secured by Spotify Chat DJ
              </p>
              <p className="text-xs text-zinc-400">
                {composerReason ??
                  "自然言語を受け取ると、Spotify 検索と再生ツールを LangGraph が自動で呼び出します。"}
              </p>
            </div>
          </div>
        </div>

        {hasMounted ? (
          <div className="pointer-events-none absolute right-4 top-6 hidden w-72 lg:block">
            <div className="space-y-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_18px_60px_rgba(24,24,27,0.05)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-2">
                      <Radio className="h-4 w-4 text-zinc-500" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                        Live Session
                      </p>
                      <p className="mt-2 text-sm font-semibold text-zinc-900">
                        {session.profile?.displayName ?? "Guest Session"}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-zinc-300">
                    {sdkStatus.connected ? "SYNCED" : "OPEN"}
                  </span>
                </div>

                <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                    <span>Account</span>
                    <span>{session.authenticated ? "READY" : "WAITING"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                    <span>LLM Agent</span>
                    <span>{session.llmConfigured ? "ARMED" : "LOCKED"}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">
                    <span>Device</span>
                    <span>{session.deviceReady ? "ONLINE" : "PENDING"}</span>
                  </div>
                </div>
              </div>

              {currentTrack ? (
                <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_18px_60px_rgba(24,24,27,0.05)]">
                  {currentTrack.imageUrl ? (
                    <Image
                      src={currentTrack.imageUrl}
                      alt={currentTrack.name}
                      width={480}
                      height={480}
                      className="h-44 w-full rounded-xl object-cover"
                    />
                  ) : (
                    <div className="flex h-44 items-center justify-center rounded-xl border border-zinc-100 bg-zinc-50 text-sm text-zinc-400">
                      Album Art
                    </div>
                  )}

                  <p className="mt-4 text-sm font-semibold text-zinc-900">
                    {currentTrack.name}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-zinc-500">
                    {currentTrack.artists.join(", ")}
                  </p>
                  <div className="mt-4 flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.16em] text-zinc-300">
                    <span>{session.playback?.deviceName ?? "Browser"}</span>
                    <span>{session.playback?.volumePercent ?? "--"}%</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
