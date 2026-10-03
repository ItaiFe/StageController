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
- `mode`: `solid` (hold at `pct`) | `pulse` | `blink` | `drain` (fall from `pct` to 0 over `ms`) | `off`.
- `perimeter.side`: `L | R | both | centre`; `look`: `intro | merge`.

## 3. States

| `state` | when | poles |
|---|---|---|
| `idle` | nothing running (also after a song, a stop or a failed launch) | all `off`. **Fall back to your own slot sequences** (idle rainbow, start comet, ...) exactly as without a show. |
| `launching` | after each launch gesture, until the decision | the presser's pole at `launchPcts[count-1]` (33/66/100), pink, solid; the other pole as it was |
| `intro` | the 3-2-1, `step` 3 then 2 then 1, one event per `introStepMs` | `polePcts` (100/66/33) in the game's colours, see below |
| `playing` | the song started (pole back to 0, the scene takes over) | both `off`; `song.id` set |
| `failing` | mismatched launch: `failBlinkCount` events alternating L, R, L, R each `failBlinkMs` (white, solid), then one `drain` event (`ms` = `failFadeMs`) on the last lit pole, then `idle` | one white pole at a time |

`game`: `solo | duet | showoff | thunder` (absent while launching/failing/idle).

Intro per game: solo -- the presser's pole pink, the other off, perimeter on the presser's side;
duet -- both poles pink; showoff -- L lime / R blue, perimeter lime-left at 3, blue-right at 2,
then both poles pink with `perimeter.look = "merge"` at 1; thunder -- both poles white,
perimeter L at 3, R at 2, centre at 1. Launch-fill colour (pink) is a placeholder: the spec only
fixes the percentages.

Later slices add `song.section`, `song.section_index`, `song.t`, a showoff `turn`, and the
`thunder` block (`phase`, `pole`, `beat`) to `playing` events. Fields already in the schema are
stable; unknown fields must be ignored.

## 4. Ordering and latency

- Events are sent in the order the controller decided them; WebSocket keeps them ordered. The
  controller ticks every ~20 ms, so an intro step lands within ~20 ms of its due time plus
  network. Do not time steps yourself: draw the latest event until the next one arrives.
- `pct`/`mode`/`ms` are the only binding LED numbers. If a client misses a `drain` end it just
  waits for the next event.
- A skipped song, a stop or a song end during the show produces an `idle` event.
- `GET /api/buttons/recent` returns the last events (button and show events mixed).
