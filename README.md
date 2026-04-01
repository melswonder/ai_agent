# Spotify Chat DJ

LangGraph を使って「会話から意図をくみ取り、Spotify の再生内容を変える」ためのアプリです。フロントは Next.js のチャット UI、バックエンドは Python / FastAPI で、Spotify OAuth / Web API / Web Playback SDK / PostgreSQL を前提にした構成です。

## できること

- Spotify アカウントを OAuth で接続
- ブラウザを Spotify 再生デバイスとして登録
- チャットから雰囲気ベースで再生を変更
- LangGraph のツール呼び出しで検索、再生、一時停止、スキップ、音量変更
- 会話ログと Spotify 接続情報を PostgreSQL に保存

## ローカル起動

1. `.env.example` を元に `.env.local` を用意
2. `docker compose up -d postgres`
3. `python3 -m pip install -r backend/requirements.txt`
4. `pnpm dev`
5. `pnpm dev:backend`

Spotify のダッシュボード側 callback URL は `https://127.0.0.1:8000/callbacks` に合わせています。Next.js は `8000` の HTTPS で立ち上がり、`/api/*` と `/callbacks` は Python バックエンドへ rewrite されます。

Docker で Python バックエンドまで起動したい場合は `docker compose up -d postgres backend` でも動かせます。

## 必須環境変数

- `PYTHON_BACKEND_URL`
- `DATABASE_URL`
- `SESSION_SECRET`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_CALLBACK_URL`
- `SPOTIFY_TOKEN_ENCRYPTION_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

## 構成

- `src/app`: App Router とフロントエンド
- `src/components`: チャット UI と Web Playback SDK ブリッジ
- `backend/app`: FastAPI / Spotify OAuth / LangGraph エージェント
- `prisma/schema.prisma`: DB スキーマ
- `docs/architecture.md`: ゴールまでの設計

## 注意

- Web Playback SDK は Spotify Premium が必要です。
- `SPOTIFY_CLIENT_SECRET` はサーバー側だけで扱い、ブラウザには出しません。
- 共有済みの client secret は必ず再発行してください。
