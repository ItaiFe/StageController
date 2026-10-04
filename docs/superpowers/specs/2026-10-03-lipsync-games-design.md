# Lipsync games + stage emulator — design

Date: 2026-10-03. Source of truth for numbers, colours and rules: the stage spec v2.0
(`backend/app/features/show/spec.json`, extracted verbatim from `stage-spec.html`). This doc
records *how* StageController implements it and the decisions taken while planning.

## Goal

1. Four games launched from the two pillars — solo (1), duet (1+1), showoff (2+2),
   thunder (3+3) — with the 3-2-1 intro, the fail blink, the in-song controls, showoff turns
   and the thunder steal loop.
2. An emulator: run the real backend (real mpv, real song) on a laptop with no hardware and
   watch every mode on a virtual stage in the web UI.

## Decisions

| # | Decision |
|---|----------|
| D1 | The show state machine lives in the backend (new feature `app/features/show/`). ESPs hold no show rules. |
| D2 | Pillars keep detecting their own gesture and POST it to `/api/buttons/press` (unchanged action names). Two **optional** fields are added: `side: "L"\|"R"` and `first_press_ago_ms: int`. The Pi reconstructs the first press as `arrival − first_press_ago_ms`. A press without `side` takes the legacy single-button path, untouched. |
| D3 | Action vocabulary stays as today (1 tap start, 2 claps, 3/5+ special, 4 skip, long stop). **Idle**: names map back to tap counts (start 1, claps 2, special 3, skip 4) and the spec's launch rule runs on counts. **In song**: today's meanings (claps, skip, stop on one long press). Both mappings are one table each in `buttons/rules.py`. |
| D4 | Emulator = `STAGE_IO=emulated` env switch inside the backend (Tasmota calls become in-memory) + a **Stage emulator** tab in the existing React app. Same backend code as on the Pi; real mpv; real song. |
| D5 | All show logic takes time as an argument (`now_ms`) or from an injected clock, so tests run whole songs instantly; the emulator runs on wall clock. |
| D6 | The controller tells the LEDs what to light with **semantic show events** on the existing `/api/buttons/ws` socket (same channel StageLeds already listens to). Pole numbers (fill %, colour, mode) are binding and travel in the event; the perimeter look is a hint (spec: perimeter drawing is illustration). Contract: `docs/show-events-contract.md`. ESP firmware changes are out of scope for this repo. |
| D7 | Each pillar ESP drives its own 100-LED pole strip (Q10 a). The emulator renders both poles and the perimeter. |
| D8 | Song analysis = sidecar file next to the audio on the Pi: `data/music/<stem>.analysis.json` (format of the song analyzer: `tempo.bpm`, `tempo.beats`, `sections[{start,end,label}]`). No DB change; no marking UI. Missing sidecar → spec fallbacks (`skipFallbackMs`, `fallbackTurnMs`, `fallback*Ms`) and a `fault: markers_missing` log line. Section label `instrumental` is "not a verse". `deploy.sh` already rsyncs `data/` to the Pi. |
| D9 | Playlists per game found by name, like `main`/`claps` today: `solo`, `duet`, `showoff`, `thunder`. |
| D10 | Open spec questions get named placeholder constants: thunder ends with the last performer alone; showoff non-verse sections belong to both (pink); no 3-2-1 replay after skip; stop → idle. |
| D11 | Three stacked local branches; nothing is pushed until the emulator plays the example song correctly in all four modes. |

## Show states

```
IDLE --gesture(side)--> LAUNCHING --decide--> INTRO(game, 3 steps x introStepMs) --> PLAYING(game) --song end/stop--> IDLE
                                   \--fail--> FAILING (failBlinkCount x failBlinkMs + failFadeMs) --> IDLE
```

- **LAUNCHING** (spec `launch`): first press on a side opens the round. Opposite side's first
  press within `syncWindowMs` joins it ("together"); a later first press is *not* part of the
  launch and is ignored for the round. Decision at `max(soloWaitMs, syncWindowMs)` after the
  latest press. Together + equal counts 1..`matchMaxCount` → game by count. Together + unequal,
  or count > `matchMaxCount` → fail. Not together → solo. Long press while idle → today's stop
  (turns everything off), no launch.
  Since a pillar reports a whole gesture at once, each gesture event fills that side's pole to
  `launchPcts[count-1]` (capped at 100) immediately on arrival.
- **INTRO**: steps 3,2,1 at `introStepMs` with poles at `polePcts` [100,66,33] then 0 at song
  start; per-game colours from spec `intro.perGame` (solo and duet: pink both — solo is
  symmetric, see Deviations; showoff: L lime, R blue, merge to pink on 1; thunder: white L, R, centre).
  The song starts when the intro ends.
- **PLAYING**: plays a random song from the game's playlist (reuse the existing shuffle/queue
  code; keep running the `main` device sequence at song start as today). Song end → existing
  `on_song_end` → IDLE (no auto-next). In-song gestures go through the D3 table:
  - skip: allowed until the middle of verse 2 (`skipFallbackMs` without sidecar); a skip after
    the cutoff is ignored (`press kind=ordinary`). Next song comes from the same game queue.
  - claps / special: existing handlers, in every game (thunder included).
  - stop: existing handler (one long press, any side).
- **Showoff turns**: verse k (1-based) belongs to L if k odd else R; choruses and every
  non-verse section → both; the **last** section → both. Without sidecar: alternate L/R every
  `fallbackTurnMs`, both for the final `fallbackTurnMs`.
- **Thunder** (user rule 2026-10-03, see Deviations; `thunder.py`): a steal loop by the clock,
  independent of the song and its sections. Left performs first: its pole full in lime; the
  rival's pole rises 0 → 100 % in blue over `cooldownMs` (20 s); at 100 % it flickers
  (`flickerHz` 2) until the rival presses, with no timeout. That 1-tap is a steal: the roles
  swap, `stealBlackoutMs` (300) blackout + smoke puff, and the cooldown restarts for the side
  that lost the stage. A press before 100 % is ignored (`too_early`; `stealBeforeFull` makes it a
  steal), a press on the performer's pole is ignored (`performer`). Each steal logs
  `steal{songId,from,to,waitedMs}`.

## Show events (WS)

Same socket and envelope style as `ButtonEvent` (`action` + `timestamp`); new `action` values,
ignored by today's StageLeds and frontend. Every show event carries the full pole state, so a
client that joins late is correct after one message:

```json
{"action": "show", "timestamp": "...", "state": "intro", "game": "showoff", "step": 2,
 "poles": {"L": {"pct": 66, "color": "lime", "mode": "solid"},
           "R": {"pct": 66, "color": "blue", "mode": "solid"}},
 "perimeter": {"look": "intro", "color": "blue", "side": "R"},
 "song": {"id": 1, "section": "verse", "section_index": 2, "t": 112.4},
 "thunder": null}
```

`mode`: `glow | solid | pulse | blink | drain | off` (`glow` carries `level`). Claps also send a
one-shot `{"action":"cue","cue":"claps",...}`. Colours are palette names (`pink|lime|blue|white`)
resolved through `spec.json` palette ramps. Full list in `docs/show-events-contract.md`.

## Emulator

- `STAGE_IO=emulated`: `devices/service.py::tasmota_command` answers from an in-memory dict
  (`POWER` on/off, `Status`) instead of HTTP — one branch at the single choke point.
- **Stage emulator** tab: T-stage drawing (perimeter split L/R, catwalk), two 100-LED pole
  canvases (reuse `components/pillar/StripCanvas`), two pillar buttons each driven by its own
  `GestureDetector` that POSTs exactly what a pillar would (`action`, `side`,
  `first_press_ago_ms`); keyboard keys (`A` = left, `L` = right) so both can be pressed at once;
  one-click macros (solo L, duet, showoff, thunder, fail 2-vs-3); live status (state, game,
  section, song time, thunder phase and fill); appliance on/off from the devices API;
  event log; seek buttons (jump to 5 s before verse 2 end / before next section) using the
  existing `/api/player/seek`.
- Idle / plain-song poles fall back to the pillar's slot sequences rendered with the existing
  `frontend/src/pillar/` port (idle rainbow, start comet), exactly as the real pillar would.
- `scripts/seed_emulator.py`: copies the example song + analysis into `data/music/`, registers
  the song, creates the four game playlists with it.

## Deviations from the spec (asked for by the user, 2026-10-03)

- **Solo is symmetric** (overrides the spec's "solo: pink on the presser's side"): an L×1 and an
  R×1 launch give identical intro and song events — both poles step 100 → 66 → 33 pink, the
  perimeter is `both`, in-song both poles glow pink. Only the launch fill (33/66/100 % on the
  presser's own pole, button feedback) and the logged side differ.
- **In-song pole glow** (overrides "poles 0 % after the intro"): full height at `ambientGlowPct`
  (35 %) as `mode: "glow"`, so binding fills stay distinct; colour by section owner — duet the
  singer, showoff the turn; the side not owning the section is off. (Thunder has its own poles.)
- **Duet singer**: the sidecars have no singer field, so a section may carry an optional
  hand-tagged `turn` (`L`/`R`/`both`); untagged songs fall back to the showoff alternation; the
  final section is always both.
- **Handover cue** (not in the spec, added by Tom): the button rings take the singer's colour
  (lime / blue / pink, dim when not singing); at each change of singer both buttons pulse together
  (`handoverPulses` 3 over `handoverPulseMs` 1000, ease in/out), then settle. In the show event
  (`buttons`), so the real pillar LEDs do it too.
- **Thunder is a time-based steal loop** (overrides the spec's whole `thunder` section: the
  beat-based countdown, rush, open/window, tag, early/halo and dark-pole applause are gone, and so
  are their tunables). Performer full in their colour, the rival rising over `cooldownMs` (20 s),
  flickering at 100 % until they press = steal, roles swap, the cooldown restarts. The intro (white
  L, R, centre) is unchanged. Claps work as in every song. New tunables `cooldownMs`, `flickerHz`,
  `stealBlackoutMs`, `stealBeforeFull` (added by Tom, 2026-10-03).

## Out of scope

Scene design (which appliance does what), section marking UI, StagePillar / StageLeds firmware
changes, announcer copy (`copySlots`), switching in-song gestures to the spec's vocabulary.
