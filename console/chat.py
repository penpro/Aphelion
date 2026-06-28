#!/usr/bin/env python3
"""
Phase 1 console client for the Local Model sandbox.

Minimal, dependency-free (Python stdlib only) chat client that talks to the
Ollama OpenAI-compatible endpoint. Purpose per CLAUDE.md: confirm the model
answers cleanly and the endpoint behaves before anything is built on top of it.

Usage:
    python chat.py                  # interactive REPL (keeps conversation history)
    python chat.py "your prompt"    # one-shot, prints the answer and exits
    python chat.py --no-stream ...  # disable token streaming
    python chat.py --show-thinking  # also surface the model's reasoning (dimmed)
    python chat.py --health         # run preflight checks only, then exit

supergemma4 is a REASONING model: the endpoint returns its chain of thought in a
separate `reasoning` field and the answer in `content`. We stream the answer to
stdout; reasoning goes to stderr (a brief "thinking…" by default, full text with
--show-thinking). Do NOT set a small max_tokens — reasoning can be long, and a
low cap truncates before any `content` is produced, yielding an empty answer.

Config via environment variables (defaults shown):
    LLM_BASE_URL     http://localhost:11434/v1   OpenAI-compatible base
    LLM_MODEL        supergemma4-unc             model tag created via Modelfile
    LLM_TEMPERATURE  0.7
    LLM_TIMEOUT      300                          seconds, for slow first-token

We point at the OpenAI-compatible path on purpose (CLAUDE.md). num_ctx is NOT a
per-request field on that API, so it is baked into the model via the Modelfile
(ollama create) rather than relied on from Ollama's truncating default.
"""
import json
import os
import sys
import urllib.error
import urllib.request

# Force UTF-8 on stdout/stderr so reasoning text and status glyphs render
# correctly regardless of the Windows console code page.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

BASE_URL = os.environ.get("LLM_BASE_URL", "http://localhost:11434/v1").rstrip("/")
MODEL = os.environ.get("LLM_MODEL", "supergemma4-unc")
TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.7"))
TIMEOUT = float(os.environ.get("LLM_TIMEOUT", "300"))

# Native (non-OpenAI) admin endpoints live at the root, e.g. /api/tags.
ROOT = BASE_URL[:-3].rstrip("/") if BASE_URL.endswith("/v1") else BASE_URL


def _get_json(url, timeout=10):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def preflight():
    """Verify the server is reachable and the model is present. Returns bool."""
    try:
        tags = _get_json(ROOT + "/api/tags")
    except urllib.error.URLError as e:
        print(
            f"[x] Cannot reach Ollama at {ROOT} — is it running? Start it with "
            f"'ollama serve'.\n    {e}",
            file=sys.stderr,
        )
        return False

    names = [m.get("name", "") for m in tags.get("models", [])]
    wanted = MODEL.split(":")[0]
    if not any(n == MODEL or n.split(":")[0] == wanted for n in names):
        print(
            f"[!] Model '{MODEL}' not found. Installed: {names or '(none)'}\n"
            f"    Create it with:  ollama create {MODEL} -f Modelfile",
            file=sys.stderr,
        )
        return False

    print(f"[ok] Ollama up at {ROOT}; model '{MODEL}' present.")
    return True


def _dim(text):
    """Dim ANSI styling when the terminal supports it; plain text otherwise."""
    return f"\033[2m{text}\033[0m" if sys.stderr.isatty() else text


def chat_once(messages, stream=True, show_thinking=False):
    """Send one chat completion. Streams the answer (`content`) to stdout and
    returns it. Reasoning (`reasoning` field) goes to stderr — a brief status by
    default, or the full trace with show_thinking. No max_tokens is set on
    purpose: a low cap can be consumed entirely by reasoning, leaving content
    empty."""
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": TEMPERATURE,
        "stream": stream,
    }
    req = urllib.request.Request(
        BASE_URL + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print(f"\n[x] HTTP {e.code} from endpoint: {body}", file=sys.stderr)
        return ""
    except urllib.error.URLError as e:
        print(f"\n[x] Connection error: {e}", file=sys.stderr)
        return ""

    if not stream:
        msg = json.loads(resp.read().decode("utf-8"))["choices"][0]["message"]
        if show_thinking and msg.get("reasoning"):
            print(_dim("[thinking]\n" + msg["reasoning"].strip()), file=sys.stderr)
        text = msg.get("content") or ""
        print(text)
        return text

    # Streaming: parse Server-Sent Events (data: {json}\n\n ... data: [DONE]).
    parts = []
    reasoning_seen = False
    content_seen = False
    for raw in resp:
        line = raw.decode("utf-8").strip()
        if not line.startswith("data:"):
            continue
        chunk = line[len("data:"):].strip()
        if chunk == "[DONE]":
            break
        try:
            delta = json.loads(chunk)["choices"][0].get("delta", {})
        except (json.JSONDecodeError, IndexError, KeyError):
            continue

        reasoning = delta.get("reasoning")
        if reasoning:
            if show_thinking:
                sys.stderr.write(_dim(reasoning))
                sys.stderr.flush()
            elif not reasoning_seen:
                sys.stderr.write(_dim("[thinking...]"))
                sys.stderr.flush()
            reasoning_seen = True

        content = delta.get("content")
        if content:
            if not content_seen:  # tidy the thinking -> answer transition
                if show_thinking and reasoning_seen:
                    sys.stderr.write("\n\n")
                elif reasoning_seen:
                    sys.stderr.write("\r" + " " * 14 + "\r")  # erase "thinking…"
                sys.stderr.flush()
                content_seen = True
            parts.append(content)
            sys.stdout.write(content)
            sys.stdout.flush()
    print()
    return "".join(parts)


def main():
    args = list(sys.argv[1:])
    stream = True
    show_thinking = False
    if "--no-stream" in args:
        stream = False
        args.remove("--no-stream")
    if "--show-thinking" in args:
        show_thinking = True
        args.remove("--show-thinking")
    if "--health" in args:
        sys.exit(0 if preflight() else 1)

    if not preflight():
        sys.exit(1)

    if args:
        chat_once([{"role": "user", "content": " ".join(args)}],
                  stream=stream, show_thinking=show_thinking)
        return

    print("Interactive chat — /exit to quit, /reset to clear history.\n")
    history = []
    while True:
        try:
            user = input("you> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user:
            continue
        if user in ("/exit", "/quit"):
            break
        if user == "/reset":
            history = []
            print("(history cleared)")
            continue
        history.append({"role": "user", "content": user})
        sys.stdout.write("bot> ")
        sys.stdout.flush()
        reply = chat_once(history, stream=stream, show_thinking=show_thinking)
        if reply:
            history.append({"role": "assistant", "content": reply})


if __name__ == "__main__":
    main()
