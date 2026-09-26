# CLAUDE.md — standing rules for this project

Offline Slay the Spire 2 guide (installable web app on GitHub Pages). Plain HTML/CSS/JS, no build step.

## Purpose
- The app gives information that helps decisions (enemy turn cycles, scaling, what an enemy punishes). It does not tell the player what to play.
- Tips are phrased as mechanics ("Poison is not an Attack, so Tangled does not affect it"), never as orders ("play Poison").

## Data rules
- All game data lives in `registry/*.json`. Never hard-code game data in `app.js`.
- Follow the latest **beta branch** patch. Record it in `registry/meta.json` (`gamePatch`, `lastReviewed`, bump `registryVersion`).
- Every enemy has a `wiki` source page and a `confidence` of `wiki` or `check`. Anything unclear or contradictory is marked `check` with a `checkNote`. Never fill gaps from memory.
- After any registry edit, run `python3 tools/check_registry.py` and commit the regenerated `registry/REVIEW.md`. CI fails otherwise.
- Ascension values are stored as `{"a": <level>, "v": "<text>"}` with the level the wiki gives.

## Code rules
- Keep `app.js` dependency-free. Relative paths only (the site lives under `/slaythespire/`).
- Wrap every storage access in the `store` helper; log errors with `log()` so they appear in Info → Diagnostics.
- If a new file must work offline, add it to `FILES` in `sw.js` and bump `CACHE`.
- Personal notes (`sts2.notes`) must survive "New run".
- Test on a phone-sized viewport (Pixel 7) before pushing.
