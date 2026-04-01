export type ChatMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type PlaybackDto = {
  isPlaying: boolean;
  progressMs: number;
  deviceName: string | null;
  volumePercent: number | null;
  context: {
    uri: string | null;
    type: string | null;
  } | null;
  item: {
    name: string;
    artists: string[];
    albumName: string;
    durationMs: number;
    imageUrl: string | null;
    uri: string | null;
  } | null;
};

export type SessionDto = {
  authenticated: boolean;
  spotifyConfigured: boolean;
  llmConfigured: boolean;
  deviceReady: boolean;
  callbackUrl: string;
  profile: {
    displayName: string | null;
    spotifyUserId: string | null;
  } | null;
  messages: ChatMessageDto[];
  playback: PlaybackDto | null;
};

export type ChatResponseDto = {
  messages: ChatMessageDto[];
  playback: PlaybackDto | null;
  assistantMessage: ChatMessageDto;
};

export type SdkStatus = {
  connected: boolean;
  deviceId: string | null;
  error: string | null;
};

export type SpotifyConfigDto = {
  clientId: string;
  clientSecret: string;
  configured: boolean;
};
