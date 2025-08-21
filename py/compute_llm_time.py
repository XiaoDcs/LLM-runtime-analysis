#!/usr/bin/env python3

import json
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
import sys
import os

TIME_JSON_PATH = "/Users/brary.lai/Documents/Code/societas-ws/time-analysis/time.json"


def parse_iso(ts: str) -> datetime:
    # Normalize 'Z' to '+00:00'
    ts = ts.replace("Z", "+00:00")
    t_index = ts.find("T")
    # Find timezone sign after the 'T' to avoid picking date '-'
    pos_plus = ts.rfind("+")
    pos_minus = ts.rfind("-")
    tz_pos_candidates = [p for p in (pos_plus, pos_minus) if p != -1 and p > t_index]
    tz_pos = max(tz_pos_candidates) if tz_pos_candidates else -1

    if tz_pos != -1:
        main = ts[:tz_pos]
        tz = ts[tz_pos:]
    else:
        main = ts
        tz = ""

    if "." in main:
        secs, frac = main.split(".", 1)
        # Pad or trim fractional seconds to 6 digits for microseconds
        if len(frac) < 6:
            frac = (frac + "000000")[:6]
        else:
            frac = frac[:6]
        norm = f"{secs}.{frac}{tz}"
    else:
        norm = f"{main}{tz}"

    return datetime.fromisoformat(norm)


def parse_metadata(meta: Any) -> Dict[str, Any]:
    if isinstance(meta, dict):
        return meta
    if isinstance(meta, str):
        meta = meta.strip()
        if meta.startswith("{") and meta.endswith("}"):
            try:
                return json.loads(meta)
            except Exception:
                return {}
    return {}


def load_messages(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    messages = data.get("data", [])

    normalized: List[Dict[str, Any]] = []
    for m in messages:
        meta = parse_metadata(m.get("metadata"))
        normalized.append({
            "message_id": m.get("message_id"),
            "thread_id": m.get("thread_id"),
            "type": m.get("type"),  # 'user' | 'assistant' | 'tool'
            "is_llm_message": m.get("is_llm_message", False),
            "created_at": m.get("created_at"),
            "created_dt": parse_iso(m.get("created_at")),
            "metadata": meta,
            # convenience accessors
            "assistant_run_id": meta.get("thread_run_id"),
            "assistant_message_id": meta.get("assistant_message_id"),
        })
    # sort by time (already appears ordered, but ensure)
    normalized.sort(key=lambda x: x["created_dt"])
    return normalized


def compute_llm_runs(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    runs: List[Dict[str, Any]] = []

    i = 0
    n = len(messages)
    while i < n:
        m = messages[i]
        if m["type"] == "assistant":
            run_id = m.get("assistant_run_id")
            # Treat every assistant message as a separate run attempt
            start_dt = m["created_dt"]
            end_dt = start_dt

            # Collect subsequent tool results that belong to this assistant message until the next assistant/user boundary
            j = i + 1
            while j < n:
                next_m = messages[j]
                if next_m["type"] == "assistant":
                    break  # next run begins
                if next_m["type"] == "user":
                    break  # user interjection; stop counting
                if next_m["type"] == "tool":
                    # Only count tool results mapped to this assistant message
                    if next_m.get("assistant_message_id") == m["message_id"]:
                        end_dt = next_m["created_dt"]
                j += 1

            runs.append({
                "run_id": run_id,
                "assistant_message_id": m["message_id"],
                "start": m["created_at"],
                "end": end_dt.isoformat(),
                "duration_seconds": max(0.0, (end_dt - start_dt).total_seconds()),
            })

            i = j
            continue
        i += 1

    return runs


def compute_llm_cycles(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Compute LLM-active windows by user-delimited cycles:
    For each user message, take the interval from that user's created_at to the last non-user message before the next user.
    This captures model generation and tool execution, and excludes any idle gap waiting for the next user (including Retry waits).
    """
    cycles: List[Dict[str, Any]] = []

    current_user: Optional[Dict[str, Any]] = None
    last_non_user_dt: Optional[datetime] = None

    for m in messages:
        if m["type"] == "user":
            # close previous cycle
            if current_user is not None and last_non_user_dt is not None:
                start_dt = current_user["created_dt"]
                if last_non_user_dt >= start_dt:
                    cycles.append({
                        "trigger_user_message_id": current_user["message_id"],
                        "start": current_user["created_at"],
                        "end": last_non_user_dt.isoformat(),
                        "duration_seconds": (last_non_user_dt - start_dt).total_seconds(),
                    })
            # start new cycle
            current_user = m
            last_non_user_dt = None
        else:
            # track last non-user timestamp within the current cycle
            if current_user is not None:
                last_non_user_dt = m["created_dt"]

    # close tail cycle if file ends without another user
    if current_user is not None and last_non_user_dt is not None:
        start_dt = current_user["created_dt"]
        if last_non_user_dt >= start_dt:
            cycles.append({
                "trigger_user_message_id": current_user["message_id"],
                "start": current_user["created_at"],
                "end": last_non_user_dt.isoformat(),
                "duration_seconds": (last_non_user_dt - start_dt).total_seconds(),
            })

    return cycles


def summarize_windows(windows: List[Dict[str, Any]]) -> Tuple[float, Optional[datetime], Optional[datetime]]:
    total_seconds = sum(w["duration_seconds"] for w in windows)
    if not windows:
        return 0.0, None, None
    starts = [parse_iso(w["start"]) for w in windows]
    ends = [parse_iso(w["end"]) for w in windows]
    return total_seconds, min(starts), max(ends)


def main():
    path = TIME_JSON_PATH
    if len(sys.argv) > 1:
        path = sys.argv[1]
    if not os.path.isabs(path):
        path = os.path.abspath(path)

    messages = load_messages(path)

    runs = compute_llm_runs(messages)
    cycles = compute_llm_cycles(messages)

    run_total, run_start, run_end = summarize_windows(runs)
    cyc_total, cyc_start, cyc_end = summarize_windows(cycles)

    print("LLM run windows (assistant-to-own-tools only):")
    print("index, run_id, assistant_message_id, start, end, duration_seconds")
    for idx, r in enumerate(runs, 1):
        print(f"{idx}, {r['run_id']}, {r['assistant_message_id']}, {r['start']}, {r['end']}, {r['duration_seconds']:.3f}")

    print()
    print(f"Run-sum LLM runtime (s): {run_total:.3f}")
    if run_start and run_end:
        print(f"Run windows overall first start: {run_start.isoformat()}")
        print(f"Run windows overall last end:   {run_end.isoformat()}")

    print("\nLLM active cycles (user-triggered to last non-user before next user):")
    print("index, trigger_user_message_id, start, end, duration_seconds")
    for idx, w in enumerate(cycles, 1):
        print(f"{idx}, {w['trigger_user_message_id']}, {w['start']}, {w['end']}, {w['duration_seconds']:.3f}")

    print()
    print(f"Cycle-sum LLM runtime (s): {cyc_total:.3f}")
    if cyc_start and cyc_end:
        print(f"Cycle windows overall first start: {cyc_start.isoformat()}")
        print(f"Cycle windows overall last end:   {cyc_end.isoformat()}")


if __name__ == "__main__":
    main() 