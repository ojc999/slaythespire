# Spire 2 Guide

An offline phone guide for **Slay the Spire 2**, Act 1 (Overgrowth and Underdocks). It shows which enemies, elites and bosses you can meet on your map, and, for each one, its turn cycle, scaling, and what it punishes. There is also a turn counter you can tap through during a fight, character-specific notes, and a **New run** button.

Data follows the latest beta branch (currently v0.111.0, 13 Aug 2026). See `registry/REVIEW.md` for the full list and the entries still flagged for checking.

## Deploy on GitHub Pages (one-off, about 5 minutes)

1. Merge this branch into `main` (open a pull request on GitHub and merge it).
2. On GitHub, open the repository → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*, **Branch** to `main`, folder `/ (root)`, then **Save**.
4. Wait 1–2 minutes. The page shows the address: `https://ojc999.github.io/slaythespire/`.

## Install on Android (Chrome)

1. Open `https://ojc999.github.io/slaythespire/` in Chrome while online.
2. Tap the **⋮** menu → **Add to Home screen** (or **Install app**) → **Install**.
3. Open it once from the home-screen icon while still online, so that it saves itself for offline use.
4. To confirm offline use works: switch on airplane mode and open it from the icon.

## Updating the data after a patch

1. Edit the JSON files in `registry/` (on GitHub you can edit in the browser: open the file → pencil icon).
   - `enemies.json`: one block per enemy (HP, moves, turn cycle, tips).
   - `maps.json`: which encounters, elites and bosses appear on each map.
   - `characters.json`: per-character notes.
   - `meta.json`: patch version and review date. Update these every time.
2. Run `python3 tools/check_registry.py` from the repository folder. It checks for mistakes (missing commas, a move name that doesn't exist, and so on), then rewrites `registry/REVIEW.md`.
   - If you edit on GitHub instead, the **Check registry** action runs the same check automatically and shows a red ✗ if something is wrong.
3. Commit and push to `main`. The phone app picks up the new data the next time you open it online (or tap **Info → Check for update**).

## Troubleshooting

- **"Could not load the game data"**: you opened `index.html` directly as a file. It must be opened from the web address, or locally with `python3 -m http.server` and then `http://localhost:8000`.
- **Something looks broken**: open **Info → Diagnostics**, tap **Copy**, and paste the text into your message. It lists the versions, your run settings and the last 50 errors.
- **Old data still showing**: open the app while online, then use **Info → Check for update**.
- **Notes disappeared**: notes are stored only in this browser, and clearing Chrome's site data deletes them. Use **Info → Export notes** now and then.

## Files

| Path | What it is |
|---|---|
| `index.html`, `styles.css`, `app.js` | The app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and home-screen install |
| `registry/` | All game data, plus the generated `REVIEW.md` |
| `tools/check_registry.py` | Registry checker and review-sheet generator |
