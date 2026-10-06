# Emulator mode map

One table per mode. Each row: the button to press in the Emulator tab, what the controller
should do, and the result checked on 2026-10-04 against the real backend with `STAGE_IO=emulated`
(no devices, no network). Checks were driven through the same REST/WS API the emulator buttons use
(`/api/buttons/press`, `/api/buttons/ws`, `/api/player/*`, `/api/devices`). The thunder steal loop and
the layout were also checked by hand in the browser.

Colours: L = lime, R = blue, both = pink, thunder intro = white. Tunables come from `spec.json`
(read live via `/api/show/tunables`). Pole % for launch = `launchPcts` (33 / 66 / 100). Thunder
cooldown = `thunder.cooldownMs` (20000 ms).

Feed lines are summaries of what the emulator writes: line 1 is the press, line 2 is
`controller: <answer>`. Show changes appear as `show → <state>`.

## Idle

| Input | Expected state / event | Poles L / R | Perimeter / scene | Appliances | Feed line | Result |
|---|---|---|---|---|---|---|
| L ×1 alone | launching, then solo intro | L 33 % pink / R off | breathes pink | none | launch count 1, then solo intro | PASS |
| L ×2 alone | launching, then solo intro | L 66 % pink / R off | breathes pink | none | launch count 2, then solo intro | PASS |
| L ×3 alone | launching, then solo intro | L 100 % pink / R off | breathes pink | none | launch count 3, then solo intro | PASS |
| R ×1 / ×2 / ×3 alone | as above on the right side | R 33 / 66 / 100 % pink | breathes pink | none | as above | PASS (×3) |
| Both ×1 | duet intro | both pink | pink | none | → duet | PASS |
| Both ×2 | showoff intro | lime / blue, then pink | lime L, blue R, then pink | none | → showoff | PASS |
| Both ×3 | thunder intro | both white | white L, R, centre | none | → thunder | PASS |
| L×1, then R×1 late (450 ms) | solo; the late R press is ignored | solo | solo | none | R: ignored, late press | PASS |
| L hold | everything off, stays idle | off | off | none | stop: everything off, stays idle | PASS |

## Solo

| Input | Expected state / event | Poles L / R | Perimeter / scene | Appliances | Feed line | Result |
|---|---|---|---|---|---|---|
| launch → intro | intro steps 3, 2, 1 | 100 → 66 → 33 % pink, both | pink both | none | Solo intro 3 / 2 / 1 | PASS |
| song start | playing solo | 100 % pink glow, both | none | none | playing solo | PASS |
| each section (chorus, verse, post-chorus, instrumental, bridge, outro) | playing, section label follows the song map | pink / pink, glow 35 % | none | chorus → floodlights, verse → spotlights, else off | playing solo · <section>: pink all round | PASS (11 sections) |
| R ×1 in song | ignored | unchanged | unchanged | none | ignored (ordinary tap) | PASS |
| L ×2 | claps cue | unchanged | unchanged | claps sound + sequence | claps | PASS |
| L ×3 | special cue | unchanged | unchanged | smoke / bubbles sequence | special | PASS |
| L ×4 after the skip cutoff | ignored | unchanged | unchanged | none | ignored: past the cutoff | PASS |
| L ×4 before the cutoff | skip to the next song, still solo | unchanged | unchanged | none | skip → next song of the same game | PASS |
| R hold | idle | off | off | all off | stop → idle | PASS |

## Duet

The duet song's sidecar must carry a `turn`/`singer` per section; the poles only change colour where
it is tagged.

| Input | Expected state / event | Poles L / R | Perimeter / scene | Appliances | Feed line | Result |
|---|---|---|---|---|---|---|
| launch → intro | intro 3, 2, 1 | pink both | pink both | none | Duet intro | PASS |
| song start | playing duet | 100 % pink glow | none | none | playing duet | PASS |
| verse, singer L (handover) | singer becomes L | lime / dim, glow 35 % | none | spotlights | ring pulse 3 × 1000 ms (handover cue) | PASS |
| verse, singer R (handover) | singer becomes R | dim / blue | none | spotlights | pulse 3 × 1000 ms | PASS |
| pre-chorus / chorus / bridge / outro (both) | singer both | pink / pink | none | chorus → floodlights | pulse only when the singer changes | PASS (14 sections) |
| R ×1, L ×2, L ×3, L ×4 before/after cutoff, R hold | same as solo | | | | | PASS (6 rows) |

## Showoff

| Input | Expected state / event | Poles L / R | Perimeter / scene | Appliances | Feed line | Result |
|---|---|---|---|---|---|---|
| launch → intro | intro 3: lime L / blue R, 2: same, 1: pink | 100 / 66 / 33 % | lime L, blue R, pink both | none | Showoff intro | PASS |
| song start | playing showoff | pink glow | none | none | playing showoff | PASS |
| verse (turn L / turn R) | that side's turn | lime / dim or dim / blue | turn colour on that side | spotlights | pulse 3 × 1000 ms at each handover | PASS |
| chorus / instrumental / bridge / outro | both | pink / pink | pink both | chorus → floodlights | | PASS (11 sections) |
| R ×1, L ×2, L ×3, L ×4 before/after cutoff, R hold | same as solo | | | | | PASS (6 rows) |

## Thunder (steal loop)

L performs first. The performer's pole is full in their colour. The rival's pole rises from 0 to
100 % over `cooldownMs`, then flickers (pulse) and waits for as long as it takes. A ×1 from the rival
while it flickers steals: blackout, smoke, the roles swap and the cooldown starts again.

| Input | Expected state / event | Poles L / R | Perimeter / scene | Appliances | Feed line | Result |
|---|---|---|---|---|---|---|
| launch → intro | intro 3, 2, 1 | white 100 / 66 / 33 % | white L, R, centre | none | Thunder intro | PASS |
| song start | playing thunder, cooldown | L 100 % lime / R 0 % blue | performer's half lime | none | thunder: Left performs (lime full), Right blue 0 % rising | PASS |
| each section | the steal loop drives the poles; only the scene follows the section | cooldown | lime L | chorus → floodlights, verse → spotlights | | PASS (12 sections on one song, 10 on another; see note) |
| hands off: cycle 1 | cooldown to ready in `cooldownMs` | L 100 % lime / R 2 → 100 % blue | lime L | none | | PASS (19.7 s against 20 s) |
| hands off: ready | R at 100 % flickers, no timeout | R 100 % blue, pulse 500 ms; ring flicker R | lime L | none | flickering = steal now | PASS (still ready 3 s later) |
| L ×1 (performer) | ignored | unchanged | unchanged | none | ignored: the performer's own pole | PASS |
| R ×2 | claps (normal in thunder) | unchanged | unchanged | claps | claps | PASS |
| R ×1 while flickering | steal | blackout, then R 100 % blue / L 0 % | blackout, then blue R | smoke | blue is at 100 % flickering → steal | PASS |
| L ×1 during the cooldown | ignored, too early | unchanged | unchanged | none | too early, lime is 14 % filled (steal at 100 %) | PASS |
| hands off: cycle 2 | ready again one `cooldownMs` after the steal | R performing, L 100 % pulse | blue R | none | | PASS (20.1 s) |
| R ×1 in song before ready | ignored, too early | unchanged | | | | PASS |
| L ×2, L ×3, L ×4 before/after cutoff | same as solo, still thunder | | | | | PASS |

Note: on the first full run, the `instrumental 1` row of one thunder song FAILed. A re-check that
seeked into that same section of that song (three times) read `instrumental` every time, and the
full thunder re-run passed every row. The failure was a driver race: it read the event sent just
before its own first seek took effect. It was not a show fault.

## Fail

| Input | Expected state / event | Poles L / R | Perimeter / scene | Appliances | Feed line | Result |
|---|---|---|---|---|---|---|
| L ×2 + R ×3 | fail blink L R L R R, last one drains, back to idle | blink | off | none | fail blink | PASS |
| L ×4 + R ×4 (above `matchMaxCount`) | fail blink, idle, no song | blink | off | none | fail blink | PASS |

## Hands off for 60 s

Each game was launched once and then left alone for 64 s. Every press, WS event and player change
was recorded.

| Mode | Song changes | State changes after start | Result |
|---|---|---|---|
| solo | 1 (the start, at 3.6 s) | none | PASS |
| duet | 1 (3.8 s) | none | PASS |
| showoff | 1 (3.7 s) | none | PASS |
| thunder | 1 (3.6 s) | none (the steal loop keeps cycling, no song change) | PASS |

### The song that seemed to change on its own

The song changes reported earlier came from presses, not from a timer. A ×4 is a skip. With only
one song per game in the library at the time, a skip looked like the song restarting. In the night
log, a ×4 sent on both sides at once restarted the song twice. The thunder cooldown has nothing to
do with it: with hands off, no mode changes the song.
