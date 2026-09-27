#!/usr/bin/env python3
"""Validate the game-data registry and write a human-readable review sheet.

Usage (from the repository root):
    python3 tools/check_registry.py            # validate, then rewrite registry/REVIEW.md
    python3 tools/check_registry.py --no-write # validate only (used by CI)

Exit code 0 = registry is valid. Exit code 1 = errors found (listed on screen).
Uses only the Python standard library.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REG = ROOT / "registry"
KINDS = {"hallway", "elite", "boss", "minion"}
INTENTS = {"attack", "block", "buff", "debuff", "status", "summon", "stun", "sleep", "heal", "escape", "none"}
CONFIDENCE = {"wiki", "check"}
WIKI = "https://slaythespire.wiki.gg/wiki/Slay_the_Spire_2:"

errors = []
warnings = []


def err(where, msg):
    errors.append(f"[{where}] {msg}")


def load(name):
    path = REG / name
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        # Point at the exact line so a missing comma is easy to find.
        print(f"ERROR: {name} is not valid JSON: line {e.lineno}, column {e.colno}: {e.msg}")
        sys.exit(1)
    except FileNotFoundError:
        print(f"ERROR: {path} not found")
        sys.exit(1)


def check_enemy(e, char_ids, enemy_ids, map_ids):
    where = e.get("id", "<no id>")
    for field in ("id", "name", "kind", "maps", "wiki", "hp", "moves", "phases", "confidence"):
        if field not in e:
            err(where, f"missing field '{field}'")
    if e.get("kind") not in KINDS:
        err(where, f"kind must be one of {sorted(KINDS)}")
    if e.get("confidence") not in CONFIDENCE:
        err(where, f"confidence must be one of {sorted(CONFIDENCE)}")
    if e.get("confidence") == "check" and not e.get("checkNote"):
        err(where, "confidence is 'check' but there is no checkNote saying what to check")
    for m in e.get("maps", []):
        if m not in map_ids:
            err(where, f"unknown map '{m}'")
    move_ids = set()
    for mv in e.get("moves", []):
        if not mv.get("id") or not mv.get("name"):
            err(where, "a move is missing id or name")
            continue
        if mv["id"] in move_ids:
            err(where, f"duplicate move id '{mv['id']}'")
        move_ids.add(mv["id"])
        if mv.get("intent") not in INTENTS:
            err(where, f"move '{mv['id']}' has intent '{mv.get('intent')}', expected one of {sorted(INTENTS)}")
        asc = mv.get("asc")
        if asc is not None and (not isinstance(asc.get("a"), int) or "v" not in asc):
            err(where, f"move '{mv['id']}' asc must look like {{\"a\": 9, \"v\": \"text\"}}")
    if not e.get("phases"):
        err(where, "needs at least one phase")
    for i, ph in enumerate(e.get("phases", [])):
        label = f"phase {i + 1}"
        for mid in ph.get("opener", []) + ph.get("cycle", []):
            if mid not in move_ids:
                err(where, f"{label} refers to unknown move '{mid}'")
        for r in ph.get("random", []):
            if r.get("move") not in move_ids:
                err(where, f"{label} random refers to unknown move '{r.get('move')}'")
        if not ph.get("opener") and not ph.get("cycle") and not ph.get("random"):
            err(where, f"{label} has no opener, cycle or random moves")
        if ph.get("cycle") and ph.get("random"):
            err(where, f"{label} has both cycle and random; use one")
    for s in e.get("starts", []):
        if s.get("at") not in move_ids:
            err(where, f"start option '{s.get('label')}' points to unknown move '{s.get('at')}'")
    for c in e.get("companions", []):
        if c not in enemy_ids:
            err(where, f"companion '{c}' is not an enemy id")
    for key in e.get("tips", {}):
        if key != "general" and key not in char_ids:
            err(where, f"tips key '{key}' is not 'general' or a character id")


def main():
    write = "--no-write" not in sys.argv
    meta = load("meta.json")
    chars = load("characters.json")
    maps = load("maps.json")
    enemies = load("enemies.json")

    char_ids = {c["id"] for c in chars}
    map_ids = {m["id"] for m in maps}
    acts = {str(m.get("act")) for m in maps}
    for m in maps:
        for field in ("id", "name", "act", "weakCount", "tests", "weakPool", "normalPool", "elites", "bosses"):
            if field not in m:
                err(m.get("id", "<map>"), f"missing field '{field}'")
    for c in chars:
        for field in ("id", "name", "mechanic", "acts"):
            if field not in c:
                err(c.get("id", "<character>"), f"missing field '{field}'")
        for a in acts - set(c.get("acts", {})):
            warnings.append(f"[{c.get('id')}] has no notes for Act {a}")
    enemy_ids = [e.get("id") for e in enemies]
    dupes = {x for x in enemy_ids if enemy_ids.count(x) > 1}
    for d in dupes:
        err(d, "duplicate enemy id")
    enemy_set = set(enemy_ids)

    for e in enemies:
        check_enemy(e, char_ids, enemy_set, map_ids)

    used = set()
    for m in maps:
        for pool in ("weakPool", "normalPool", "events"):
            for enc in m.get(pool, []):
                for eid in enc.get("enemies", []):
                    used.add(eid)
                    if eid not in enemy_set:
                        err(m["id"], f"{pool} '{enc.get('name')}' refers to unknown enemy '{eid}'")
        for pool in ("elites", "bosses"):
            for eid in m.get(pool, []):
                used.add(eid)
                if eid not in enemy_set:
                    err(m["id"], f"{pool} refers to unknown enemy '{eid}'")
    for e in enemies:
        used.update(e.get("companions", []))
    for eid in enemy_set - used:
        warnings.append(f"[{eid}] not used by any map encounter or companion list")

    for w in warnings:
        print("WARNING:", w)
    if errors:
        for x in errors:
            print("ERROR:", x)
        print(f"\n{len(errors)} error(s). Registry NOT valid.")
        sys.exit(1)

    print(f"OK: {len(enemies)} enemies, {len(maps)} maps, {len(chars)} characters. Patch: {meta.get('gamePatch')}")
    if write:
        write_review(meta, maps, enemies)
        print("Wrote registry/REVIEW.md")


def fmt_moves(e, ids):
    names = {m["id"]: m["name"] for m in e["moves"]}
    return " → ".join(names[i] for i in ids)


def write_review(meta, maps, enemies):
    by_id = {e["id"]: e for e in enemies}
    out = [
        "# Registry review sheet",
        "",
        "Generated by `tools/check_registry.py` — do not edit by hand; edit the JSON files and re-run.",
        "",
        f"- Registry version: {meta['registryVersion']}",
        f"- Game patch: {meta['gamePatch']}",
        f"- Last reviewed: {meta['lastReviewed']}",
        "",
    ]
    flagged = [e for e in enemies if e["confidence"] == "check"]
    out += ["## Entries flagged for checking", ""]
    out += [f"- **{e['name']}** — {e['checkNote']}" for e in flagged] or ["- None"]
    out.append("")
    for m in maps:
        out += [f"## {m['name']} (Act {m['act']})", ""]
        seen = []
        for pool in ("weakPool", "normalPool", "events"):
            for enc in m.get(pool, []):
                seen += [x for x in enc["enemies"] if x not in seen]
        for x in m["elites"] + m["bosses"]:
            if x not in seen:
                seen.append(x)
        for x in list(seen):
            for c in by_id[x].get("companions", []):
                if c not in seen:
                    seen.append(c)
        out += ["| Enemy | Kind | HP | Pattern | Source | Status |", "|---|---|---|---|---|---|"]
        for x in seen:
            e = by_id[x]
            parts = []
            for ph in e["phases"]:
                bits = []
                if ph.get("opener"):
                    bits.append("open: " + fmt_moves(e, ph["opener"]))
                if ph.get("cycle"):
                    bits.append("loop: " + fmt_moves(e, ph["cycle"]))
                if ph.get("random"):
                    names = {m["id"]: m["name"] for m in e["moves"]}
                    bits.append("random: " + ", ".join(f"{names[r['move']]} {r['w']}%" for r in ph["random"]))
                parts.append(f"*{ph['name']}*: " + "; ".join(bits))
            status = "⚠ check" if e["confidence"] == "check" else "wiki"
            out.append(f"| {e['name']} | {e['kind']} | {e['hp']} | {'<br>'.join(parts)} | [wiki]({WIKI}{e['wiki']}) | {status} |")
        out.append("")
    (REG / "REVIEW.md").write_text("\n".join(out) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
