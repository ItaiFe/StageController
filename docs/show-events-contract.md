# Show events contract (StageController -> StagePillar / StageLeds)

Version 1 -- 2026-10-03. Numbers and colours come from the stage spec
(`backend/app/features/show/spec.json`); this file only describes the wire. Change it first.

## 1. Posting a gesture (pillar -> controller)

`POST /api/buttons/press` keeps its body and action names (`start|stop|skip|claps|special`).
Two **optional** fields join the show state machine:

| field | meaning |
|---|---|
| `side` | `"L"` or `"R"` (left/right as seen standing at the entrance facing the stage). Present = side-aware press handled by the show director. Absent = legacy single-button path, unchanged. |
| `first_press_ago_ms` | ms between the gesture's **first** press and the moment the request is sent. The controller reconstructs `first_press = arrival - first_press_ago_ms`; two pillars are "together" when their first presses are within `syncWindowMs`. Default 0. |

Idle: the action name stands for the tap count (`start` 1, `claps` 2, `special` 3, `skip` 4;
`special` also covers 5+) and feeds the launch rule. A long press (`stop`) while idle turns
everything off. In song the actions keep today's meaning (claps, special, skip, stop).

Response for a side-aware press: `{"status":"ok","action":..,"side":..,"show_state":..}` or
`{"status":"ignored",...,"reason":..}`.

## 2. Event envelope (controller -> clients)

Same socket as button events: `ws://<host>/api/buttons/ws`. Show events have `"action": "show"`
(button events keep `start|stop|...`; clients that do not know `show` must ignore it).

```json
{"action":"show","timestamp":"2026-10-03T20:15:01.123","state":"intro","game":"showoff","step":2,
 "poles":{"L":{"pct":66,"color":"lime","mode":"solid","ms":null},
          "R":{"pct":66,"color":"blue","mode":"solid","ms":null}},
 "perimeter":{"look":"intro","color":"blue","side":"R"},
 "song":null,"thunder":null}
```

Every show event carries the **full** pole state: a client that joins late is correct after one
message, and an event never needs the one before it. Poles light from the bottom up, toward the
button; `pct` is the fill (0-100), binding. `perimeter` is a hint (spec: illustration); absent = no
perimeter instruction.

- `color`: palette name `pink | lime | blue | white` (or `null` when off). Resolve through the
  spec's palette ramps; apply the colour tunables (gain, drift) on the LED side.
- `mode`: `solid` (hold at `pct`) | `pulse` (at `pct`; `ms` = one pulse when set, else your own rate) |
  `blink` | `drain` (fall from `pct` to 0 over `ms`) | `off`.
- `perimeter.side`: `L | R | both | centre`; `look`: `intro | merge | turn | blackout | new_look | halo`.

## 3. States

| `state` | when | poles |
|---|---|---|
| `idle` | nothing running (also after a song, a stop or a failed launch) | all `off`. **Fall back to your own slot sequences** (idle rainbow, start comet, ...) exactly as without a show. |
| `launching` | after each launch gesture, until the decision | the presser's pole at `launchPcts[count-1]` (33/66/100), pink, solid; the other pole as it was |
| `intro` | the 3-2-1, `step` 3 then 2 then 1, one event per `introStepMs` | `polePcts` (100/66/33) in the game's colours, see below |
| `playing` | the song started (pole back to 0, the scene takes over), and again whenever the song's section or the showoff turn changes | both `off`; `song` set (see below) |
| `failing` | mismatched launch: `failBlinkCount` events alternating L, R, L, R each `failBlinkMs` (white, solid), then one `drain` event (`ms` = `failFadeMs`) on the last lit pole, then `idle` | one white pole at a time |

`game`: `solo | duet | showoff | thunder` (absent while launching/failing/idle).

Intro per game: solo -- the presser's pole pink, the other off, perimeter on the presser's side;
duet -- both poles pink; showoff -- L lime / R blue, perimeter lime-left at 3, blue-right at 2,
then both poles pink with `perimeter.look = "merge"` at 1; thunder -- both poles white,
perimeter L at 3, R at 2, centre at 1. Launch-fill colour (pink) is a placeholder: the spec only
fixes the percentages.

When a game's song starts the controller first broadcasts the **legacy** button event
`{"action":"start","playlist_name":"<game>"}` (exactly what a plain start press sends), then the
first `playing` show event. Clients that only know legacy actions (StageLeds, pillar firmware)
therefore enter their "play" look as before; a later `idle` show event is followed by the
existing legacy `stop` on song end.

`playing` events carry `song`: `id`, `section` (the analyzer's label: `intro | verse | chorus |
bridge | instrumental | outro`, `null` when the song has no sidecar markers), `section_index`
(the analyzer's running number for that label), `t` (song seconds when the event was sent).
Showoff only: `turn` = `L | R | both` -- verses alternate L, R, L ...; every other section and the
last section is `both` -- with `perimeter = {look: "turn", color: lime | blue | pink, side: turn}`.
Other games send `turn: null`. A turn event is sent at the section boundary (within one ~20 ms
tick), not ahead of it. Fields already in the schema are stable; unknown fields must be ignored.

Section scene: on each section change the controller itself switches the appliances --
`floodLights*` on in a `chorus`, `spotlights*` on in a `verse`, both off in every other section
(names matched case-insensitively by prefix; `backend/app/features/show/scene.py`). This adds no
show-event field: the switching shows up in the devices API (`is_on`) like any other device change.

### Thunder

At the end of verses 2..N-1 a thunder game sends one `playing` event **per beat** with
`thunder = {phase, pole, beat}`: `pole` is the active pole (random per window), `beat` counts from
beat 0, the beat nearest the verse change. The active pole is white, the other pole is `off`.

| `phase` | beats | active pole |
|---|---|---|
| `build` | `-countdownBeats .. -rushBeats-1` | `solid`, `pct` steps up 100/countdownBeats per beat (12/25/38/50 at 8 beats) |
| `rush` | `-rushBeats .. -1` | `pulse` with `ms` = half a beat (two pulses per beat), `pct` keeps climbing to 100 |
| `open` | `0` | 100, `solid` |
| `window` | `1 .. W-1` | `solid`, draining 100/W per beat (75/50/25 at W = 4); at beat W the window is over |
| `tag` | the beat the tag fires on | both `off`, `perimeter.look = "blackout"`, for half a beat |
| `new_look` | after the blackout | both `off`, `perimeter.look = "new_look"` (scene placeholder) |
| `early` | from the early press, for `flareBars` bars | the active pole `drain` from where it was over `earlyFallMs`, `perimeter.look = "halo"` |

After the window (or the halo, or the new look) the next event has `thunder: null` (rest).
`W` = `windowBeatsShort`, or `windowBeatsLong` when the short one would last less than
`minWindowMs`. A song without beats uses an even grid: `countdownBeats` steps over
`fallbackCountdownMs`, `windowBeatsShort` steps over `fallbackWindowMs`.

Presses during a window (side-aware POSTs):

- `start` (1 tap) on the **active** pole, pressed in `[change - graceMs, window end]` = **tag**:
  fires at the first beat at or after the change, the press and the *arrival* of the POST. A pillar
  reports a gesture only after it has decided the tap count (~400 ms after the release), so a tag
  pressed on the change usually fires one beat later; that is by design, the blackout cannot land
  before the controller knows about it. The press time is `arrival - first_press_ago_ms`, so send
  an honest `first_press_ago_ms`. The smoke puff (the `special` device sequence) runs on the
  blackout.
- `start` on the active pole after the countdown started but before `change - graceMs` = **early**:
  the `early` event goes out at once, the countdown and window are cancelled.
- `claps` during the countdown/window: only the **dark** pole's applause counts; the active
  pole's answers `{"status":"ignored","reason":"active_pole"}`.
- Anything else keeps today's meaning.

Skip in song is accepted until the middle of verse 2 (`skipFallbackMs` without markers); later
skips answer `{"status":"ignored","reason":"after_cutoff"}`.

## 4. Ordering and latency

- Events are sent in the order the controller decided them; WebSocket keeps them ordered. The
  controller ticks every ~20 ms, so an intro step lands within ~20 ms of its due time plus
  network. Do not time steps yourself: draw the latest event until the next one arrives.
- `pct`/`mode`/`ms` are the only binding LED numbers. If a client misses a `drain` end it just
  waits for the next event.
- A skipped song, a stop or a song end during the show produces an `idle` event.
- `GET /api/buttons/recent` returns the last events (button and show events mixed).
