# Lipsync games + emulator — implementation plan

Design: `docs/superpowers/specs/2026-10-03-lipsync-games-design.md`. Spec numbers:
`backend/app/features/show/spec.json` (never copy a number into code; read it from the spec /
tunables).

## Conventions (follow the existing code)

- Backend feature folder `app/features/show/` with the repo's usual split: `router.py`,
  `service.py`, `schemas.py`, `models.py` (only if a table is needed). Pure logic modules are
  kept free of player/device/DB imports so they unit-test without audio hardware (see
  `buttons/rules.py`'s docstring) and take `now_ms` as an argument.
- Tests: pytest in `backend/tests/test_show_*.py`, vitest next to the TS file (`*.test.ts`).
- Frontend: components in `src/components/`, CSS file per component, API calls in `src/api.ts`.
- Comments: sparse, explain *why*, same tone as the existing code. No new dependencies.

## Dev environment on this Mac (Homebrew is broken here — use exactly these)

```bash
source ~/.local/share/stage-mpv/env.sh          # DYLD_INSERT_LIBRARIES shim so libmpv loads
cd ~/StageController/backend
.venv/bin/python -m pytest -q                    # NOT `uv run` (uv strips DYLD_* vars)
STAGE_IO=emulated .venv/bin/python -m uvicorn app.main:app --port 8000
cd ~/StageController/frontend
~/.bun/bin/bun run test ; ~/.bun/bin/bun run build ; ~/.bun/bin/bun run lint ; ~/.bun/bin/bun run dev
```
`~/.local/bin/uv sync` to add dev deps if ever needed. Baseline: 68 backend, 59 frontend tests green.

Example song: audio `~/Downloads/WhatsApp Audio 2026-10-03 at 13.20.27.mp4` (AAC in MP4 —
store it as `.m4a`), analysis `~/Downloads/_6igcfvq2BQ.analysis.json`
(Bryan Adams & Tina Turner, It's Only Love, 103.4 bpm, verses 66.04–89.21, 104.77–126.67,
194.49–215.53 → skip cutoff 115.72 s; one thunder window at verse-2 end 126.67 s;
W = 4 beats ≈ 2.32 s ≥ 2 s). Audio is never committed. A trimmed analysis (tempo + sections,
no lyrics/words/activity/energy) is committed as `backend/tests/fixtures/its_only_love.analysis.json`.

---

## Slice 1 — branch `lipsync/1-launch-emulator`: launch, intro, solo/duet, emulator v1

1. `show/tunables.py`: `defaults()` from `spec.json` `tunables[].value`; `get(id)`; in-memory
   overrides (persistence comes in slice 2). `palette(name, gain)` → RGB from the ramp middle.
2. `show/launch.py` (pure): `LaunchArbiter` with `on_gesture(side, taps, first_press_ms, now_ms)`
   and `poll(now_ms) -> LaunchResult | None` (`game`, `count_l`, `count_r`, `gap_ms`) per the
   design's LAUNCHING rules. Tests: solo L/R, 1+1, 2+2, 3+3, 2 vs 3 fail, 4+4 fail
   (> matchMaxCount), opposite side after `syncWindowMs` ignored, decision timing exactly at
   `max(soloWaitMs, syncWindowMs)` after last press, tunable change respected.
3. `buttons/rules.py`: add `IDLE_TAPS = {"start": 1, "claps": 2, "special": 3, "skip": 4}` and
   the in-song table (`IN_SONG = {"start": "tap", "claps": "claps", "special": "special",
   "skip": "skip", "stop": "stop"}`), with tests. Keep `is_action_allowed` for the legacy path.
4. `show/events.py` + `schemas.py`: `ShowEvent` model per the design (poles L/R, perimeter,
   song, thunder) and `docs/show-events-contract.md` (envelope, every `state`, pole modes,
   palette names, POST fields `side`/`first_press_ago_ms`, ordering/latency notes for
   StagePillar and StageLeds authors). Broadcast through the existing `buttons.router.manager`
   (generalise `broadcast` to accept any pydantic model; `last_events` keeps working).
5. `show/service.py`: `ShowDirector` — owns the state machine, an asyncio tick loop (~20 ms)
   started on app startup, a `Clock` (`now_ms()`; real = `time.monotonic`; tests inject a fake),
   and a small player adapter (start game playlist, current song time, stop) so tests can run
   without mpv. Implements IDLE/LAUNCHING/FAILING/INTRO/PLAYING for **solo and duet**
   (showoff/thunder launch and intro also work; their in-song behaviour comes later). Song start
   reuses `handle_start_action`'s logic parameterised by playlist name (extract a helper; the
   legacy `start` keeps using `main`). `on_song_end` (main.py) and stop also notify the director.
6. `buttons/router.py`: `ButtonPress` gains optional `side`, `first_press_ago_ms`. With `side`
   → `director.on_press(...)`; without → legacy path byte-for-byte. Both POST endpoints keep
   working.
7. `STAGE_IO=emulated` in `core/config.py`; `devices/service.py::tasmota_command` answers from an
   in-memory dict when emulated. Test it.
8. `scripts/seed_emulator.py --audio PATH --analysis PATH`: copies into `data/music/<stem>.m4a`
   + `<stem>.analysis.json`, registers the song via `create_song_from_file`, creates playlists
   `solo duet showoff thunder` containing it (idempotent).
9. Frontend **Stage emulator** tab (`components/StageEmulator.tsx` + css, `useShowEvents` hook):
   T-stage, two `StripCanvas` poles from show events (pillar slot sequences when no show event
   applies), two pillar buttons (`GestureDetector` each, POST with `side` and
   `first_press_ago_ms`), keys `A`/`L`, macros (solo L, duet, showoff, thunder, fail 2v3),
   status panel, appliance list, event log. `buttonsApi.press` gains the optional fields.
   vitest for any non-trivial pure helper (event → pole pixels).
10. Run everything; launch the emulator; solo and duet play the example song end to end.

## Slice 2 — branch `lipsync/2-songmap-showoff-controls` (stacked on 1)

1. `show/songmap.py` (pure): load sidecar → `SongMap(bpm, beats, sections, verses)`;
   `skip_cutoff_s()`, `turn_owner(t)` (L/R/both), `section_at(t)`, `beat_at/after(t)`;
   fallbacks when missing. Tests on the committed fixture (cutoff 115.72, owners per section)
   and on "no sidecar".
2. Director: showoff turns → show events (`state: "playing"`, `turn`), skip gate, in-song
   table, `song.section` in every event, `fault markers_missing` when no sidecar.
3. Tunables persistence: `show/models.py` table `show_tunables(id, value JSON)`,
   `GET /api/show/tunables` (id, value, default, unit, group, he label from spec.json),
   `PUT /api/show/tunables/{id}`, logs `tunable_change`. UI: a "Show tunables" panel in the
   existing Stage control tab (mandatory three first, then the rest grouped).
4. `show/analytics.py`: append-only `data/show-events.jsonl`, one line per spec event
   (`launch_attempt`, `song_start`, `song_end`, `press`, `window`, `tunable_change`, `fault`,
   `night_note`) with `t` ISO + `mono` ms; `POST /api/show/note`; `GET /api/show/log` (tail,
   for the emulator).
5. Emulator: section timeline bar with turn colours and cutoff marker; seek buttons; JSONL tail.

## Slice 3 — branch `lipsync/3-thunder` (stacked on 2)

1. `show/thunder.py` (pure): windows for verses 2..N−1, phase at song time t (build/rush/open/
   window/tag/early/rest), pole pct/mode per phase, press classification (tag/early/dark/
   ordinary) incl. arrival-time rule, outcome + `window` log record. Injected RNG. Tests on the
   fixture: window at 126.67, W = 4, countdown starts 8 beats before, tag fire beat, early fall,
   grace edge, no-press → none, dark-pole claps allowed / active-pole claps rejected, fallback
   timings without beats.
2. Director wiring: thunder events each beat during countdown/window, tag → half-beat blackout
   event + run the `special` device sequence for the smoke puff (scene design later), early →
   halo event; thunder ending placeholder.
3. Emulator: thunder phase display, beat flash, active/dark pole rendering, "jump to 10 s
   before the window" button.
4. Headless full-song test per mode (`test_show_full_song.py`): fake clock + fake player run the
   fixture song from launch to song end for solo, duet, showoff, thunder (with a scripted tag)
   and assert the ordered event/state sequence and the JSONL lines.

## Acceptance (before anything is pushed)

- All backend and frontend tests green, build + lint clean.
- With `STAGE_IO=emulated` and the seeded example song, from the emulator tab: each of solo,
  duet, showoff, thunder launches with the right intro, mpv plays the real song (player
  `current_time` advancing), poles/perimeter follow the spec through the song (showoff turns at
  66.04/104.77/194.49, thunder window at 126.67), skip before 115.72 s works and after is
  ignored, stop works, fail 2v3 blinks and returns to idle, song end returns to idle.
- An independent review subagent signs off; findings fixed or explicitly declined.
