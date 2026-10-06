# Stage emulator — target (what "done" looks like)

Date: 2026-10-03. Companion to `2026-10-03-lipsync-games-design.md`. Reference look:
`stage-spec.html` v2.0 (its demo script: `Stage`, `perimeter`, `paintDrift`/`drift`, `introFrame`,
`thFrame`). Rules and numbers: `backend/app/features/show/spec.json`.

**Goal:** someone watching the Emulator tab can tell exactly what the real stage is doing and why:
every light the controller drives is drawn and moving like in the reference, and every press is
explained in words, together with what the controller sent in reply.

## 1. The stage drawing (same as the reference)

- T-shaped stage from the reference (`POLY` / `TPATH`), perimeter LEDs every 15 px along the
  outline, catwalk, labels. Two poles of 24 segments each under the buttons, with a % readout and a
  ring around each button, as in the reference `Stage()`.
- Appliances from the devices API drawn at fixed spots on the stage, each lit live when the
  controller switches it (emulated Tasmota state), with its name: `floodLights (x2)`, `spotlights`,
  `backLights`, `flickers`, `movingLights`, `smoke`, `bubbles`.

## 2. Lights per state (driven by live show events; pole numbers are binding)

| State | Poles | Perimeter / scene |
|---|---|---|
| Idle | pillar idle slot sequence (as the real pillar) | the reference idle drift |
| Launching | presser's pole fills to 33 / 66 / 100 % per click | reference launch feedback |
| Intro solo / duet / showoff / thunder | 100 → 66 → 33 % per step, per-game colours | reference `introFrame` per game: solo and duet pink on both sides (solo is symmetric: L or R gives the same intro), showoff L lime → R blue → merge to pink, thunder white L → R → centre |
| Fail 2v3 | alternate L, R, L, R white blinks, then the last one fades | no perimeter (reference `introFrame('fail')`) |
| Playing — per section | glow, full height at `ambientGlowPct` (35 %), in the section owner's colour: solo both pink; duet the singer (L lime / R blue / both pink); showoff the turn; the side not owning the section off | reference drift after the intro; colour per section: pink, and in showoff the turn colour (verse 1 L lime, verse 2 R blue, verse 3 L lime; non-verse and the last section pink, both sides) |
| Change of singer | both button rings (drawing and the big pillar buttons) pulse together 3× over ~1 s, ease in/out, then show the new singer's colour (lime / blue / pink, dim when not singing) | — |
| Thunder steal loop | performer's pole 100 % in their colour (L lime first); the rival's pole rises 0 → 100 % in its colour over `cooldownMs` (20 s), then flickers (`flickerHz` 2) until the rival presses; no timeout | the performer's half of the edge in their colour, the rival's half rising dimly and flickering with its pole; both button rings in the players' colours, the rival's flickering at 100 % |
| Thunder steal / ignored presses | steal (rival 1 tap at 100 %): `stealBlackoutMs` blackout, roles swap, cooldown restarts (+ smoke); too early or the performer's own pole: ignored, said in the feed with the fill % | blackout, then the new performer's colours |
| Appliances | — | whatever the controller actually switches (start/claps/special sequences, smoke on a steal), lit on the drawing |

The spec leaves the in-song appliance scene to a later design session. First rule, decided by Tom
on 2026-10-03: **floodlights on during choruses, spotlights on during verses**, off in every other
section. It is applied by the backend director on each section change (it already emits an event
there), so the real Pi does it too, not only the emulator. It is one small table in `show/`, mapping
section label → appliance names, so more rules are a one-line change. Everything goes off at
stop / song end (`end_show`, as today). Other appliances only do what the existing
`main` / `claps` / `special` sequences do.

## 3. Words on screen for every press

A timestamped feed, newest first, one line per press plus what the controller did in reply:

- what came in: side, gesture (N taps / hold), the state at that moment (idle / intro / playing
  <game> at <section> <t>s);
- what it means under the current map (idle: launch count; in song: claps / special / skip / stop /
  thunder steal / too early / performer's own pole), and the backend's answer (ok / ignored + reason in
  words, e.g. "skip ignored: after the mid-verse-2 cutoff");
- what the controller pushed in reply: show looks (pole % / colour / mode), appliance on/off by name,
  player play / skip / stop.

Example: `14:46:53  Right pressed 3× while idle → waiting 500 ms for the left side… → Thunder intro (white)`.

## 4. Controls

- L and R pillar buttons (mouse or touch) and the keys `←` / `→`: N quick clicks = N taps; hold = stop.
- Deterministic press buttons (same gesture detector as a click, on their own clock): L / R ×1–5,
  L / R hold, Both ×1–3, L×2 + R×3 (fail), L×1 then R×1 late (solo).
- "Both pressed": N taps on it = N + N on the two pillars; hold = stop.
- Launch macros, seek buttons, the song map with turn colours, cutoff and playhead, the night log
  (newest lines, live).
- A press guide in the button column, a "Now: … · Next press does: …" banner, a legend.
- A "👏 CLAPS" badge (~2 s) and an applause sound (browser only, mute toggle) on each claps cue.

## 5. Acceptance (checked in the browser on the real backend, STAGE_IO=emulated, real mpv)

1. Solo, duet, showoff, thunder each launch, play the real song with the right intro, and show the
   per-section look through the song (showoff turns at 66.04 / 104.77 / 194.49 s); thunder runs its
   steal loop by the clock (rise over `cooldownMs`, flicker at 100 %, a steal swaps the roles; a too-early
   press is ignored and says so).
2. Fail 2v3 blinks and goes back to idle; skip works before 115.72 s and is ignored after (said on
   screen); hold stops; the song ending returns to idle.
3. No unexpected song change with hands off for 60 s in every mode.
4. Every press shows its line in the feed; 2 / 3 / 4 quick clicks register as 2 / 3 / 4 taps.
5. Appliances light on the drawing when switched.
6. Backend and frontend tests green, build clean, lint shows only the existing `App.tsx:105` error.
