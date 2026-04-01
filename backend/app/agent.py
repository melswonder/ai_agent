from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition
from sqlalchemy.orm import Session

from backend.app.config import get_settings, require_openai_api_key
from backend.app.spotify import (
    get_current_playback_state,
    pause_playback,
    play_playlist,
    play_track_uris,
    queue_track,
    resume_playback,
    search_playlists,
    search_tracks,
    set_volume,
    skip_to_next,
    skip_to_previous,
)


BASE_SYSTEM_PROMPT = """
You are "Control Hub Assistant", a Japanese-speaking assistant with optional service integrations.

Rules:
- Always answer in Japanese.
- You can chat normally even when no integrations are connected.
- Use tools only when an available integration clearly matches the user's request.
- If the user asks to control a service that is not connected, explain that briefly and continue helping in natural language.
- For Spotify-related playback changes, infer likely music search terms from mood words like "落ち着いた", "ドライブ向け", "テンション上がる", "夜っぽい".
- If the Spotify intent clearly implies immediate playback and Spotify tools are available, perform the action instead of asking for confirmation.
- If the request is ambiguous, ask one short follow-up question.
- Keep the final answer short, concrete, and practical.
""".strip()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def build_system_prompt(*, spotify_connected: bool) -> str:
    integration_lines = [
        f"- Spotify: {'connected and controllable' if spotify_connected else 'not connected'}",
        "- Google Calendar: not connected yet (planned future integration)",
    ]

    if spotify_connected:
        integration_lines.append(
            "- Spotify tools are available for search, playback, queue, skip, pause, resume, and volume."
        )
    else:
        integration_lines.append(
            "- No Spotify control tools are available right now, so handle music requests conversationally unless the user connects Spotify later."
        )

    return f"{BASE_SYSTEM_PROMPT}\n\nCurrent integrations:\n" + "\n".join(
        integration_lines
    )


def create_spotify_tools(db: Session, session_id: str) -> list[Any]:
    @tool("search_tracks")
    def search_tracks_tool(query: str, limit: int = 5) -> str:
        """Search Spotify tracks by mood, artist, song name, or natural-language query."""
        tracks = search_tracks(db, session_id, query, limit)
        return _json({"tracks": tracks})

    @tool("search_playlists")
    def search_playlists_tool(query: str, limit: int = 5) -> str:
        """Search Spotify playlists when the user asks for a vibe or a themed playlist."""
        playlists = search_playlists(db, session_id, query, limit)
        return _json({"playlists": playlists})

    @tool("play_tracks")
    def play_tracks_tool(uris: list[str]) -> str:
        """Start playback for one or more Spotify track URIs on the user's current device."""
        play_track_uris(db, session_id, uris)
        return _json({"ok": True, "action": "play_tracks", "uris": uris})

    @tool("play_playlist")
    def play_playlist_tool(context_uri: str) -> str:
        """Play a Spotify playlist by its context URI."""
        play_playlist(db, session_id, context_uri)
        return _json(
            {"ok": True, "action": "play_playlist", "contextUri": context_uri}
        )

    @tool("pause_playback")
    def pause_playback_tool() -> str:
        """Pause Spotify playback."""
        pause_playback(db, session_id)
        return _json({"ok": True, "action": "pause_playback"})

    @tool("resume_playback")
    def resume_playback_tool() -> str:
        """Resume Spotify playback."""
        resume_playback(db, session_id)
        return _json({"ok": True, "action": "resume_playback"})

    @tool("skip_to_next")
    def skip_to_next_tool() -> str:
        """Skip to the next Spotify track."""
        skip_to_next(db, session_id)
        return _json({"ok": True, "action": "skip_to_next"})

    @tool("skip_to_previous")
    def skip_to_previous_tool() -> str:
        """Return to the previous Spotify track."""
        skip_to_previous(db, session_id)
        return _json({"ok": True, "action": "skip_to_previous"})

    @tool("set_volume")
    def set_volume_tool(volume_percent: int) -> str:
        """Set the current Spotify device volume from 0 to 100."""
        set_volume(db, session_id, volume_percent)
        return _json(
            {"ok": True, "action": "set_volume", "volumePercent": volume_percent}
        )

    @tool("queue_track")
    def queue_track_tool(uri: str) -> str:
        """Queue a Spotify track URI after the current item."""
        queue_track(db, session_id, uri)
        return _json({"ok": True, "action": "queue_track", "uri": uri})

    @tool("get_current_playback")
    def get_current_playback_tool() -> str:
        """Read the current Spotify playback state before deciding how to change the music."""
        playback = get_current_playback_state(db, session_id)
        return _json({"playback": playback})

    return [
        search_tracks_tool,
        search_playlists_tool,
        play_tracks_tool,
        play_playlist_tool,
        pause_playback_tool,
        resume_playback_tool,
        skip_to_next_tool,
        skip_to_previous_tool,
        set_volume_tool,
        queue_track_tool,
        get_current_playback_tool,
    ]


def _to_langchain_history(messages: list[dict[str, str]]) -> list[Any]:
    history: list[Any] = []
    for message in messages:
        if message["role"] == "USER":
            history.append(HumanMessage(content=message["content"]))
        else:
            history.append(AIMessage(content=message["content"]))
    return history


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
                continue

            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])

        return "\n".join(parts).strip()

    return ""


def run_control_agent(
    db: Session,
    session_id: str,
    history: list[dict[str, str]],
    user_input: str,
    *,
    spotify_connected: bool,
) -> dict[str, Any]:
    settings = get_settings()
    tools = create_spotify_tools(db, session_id) if spotify_connected else []
    system_prompt = build_system_prompt(spotify_connected=spotify_connected)
    model = ChatOpenAI(
        api_key=require_openai_api_key(),
        model=settings.openai_model,
        temperature=0.3,
    )

    conversation = [*_to_langchain_history(history), HumanMessage(content=user_input)]

    if not tools:
        response = model.invoke([SystemMessage(content=system_prompt), *conversation])
        assistant_message = (
            _content_to_text(response.content)
            if isinstance(response, AIMessage)
            else "お手伝いできることがあれば続けて話してください。"
        )
        return {
            "assistantMessage": assistant_message
            or "お手伝いできることがあれば続けて話してください。",
            "toolMessages": [],
        }

    model_with_tools = model.bind_tools(tools)
    graph = StateGraph(MessagesState)

    def call_model(state: MessagesState) -> dict[str, list[Any]]:
        response = model_with_tools.invoke(
            [SystemMessage(content=system_prompt), *state["messages"]]
        )
        return {"messages": [response]}

    graph.add_node("agent", call_model)
    graph.add_node("tools", ToolNode(tools))
    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", tools_condition, ["tools", END])
    graph.add_edge("tools", "agent")

    app = graph.compile()
    result = app.invoke(
        {"messages": conversation},
        {"recursion_limit": 12},
    )

    messages = result["messages"]
    last_message = messages[-1] if messages else None
    tool_messages = [
        message.content for message in messages if isinstance(message, ToolMessage)
    ]
    assistant_message = (
        _content_to_text(last_message.content)
        if isinstance(last_message, AIMessage)
        else "操作を反映しました。"
    )

    return {
        "assistantMessage": assistant_message
        or "操作は完了しました。必要なら次の曲調も調整できます。",
        "toolMessages": tool_messages,
    }
