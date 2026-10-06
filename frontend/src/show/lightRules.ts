// What every light does in each mode, in words, for the emulator's rules panel. Numbers come from the
// spec's tunables; the rules themselves mirror backend show/events.py, thunder.py (the steal loop) and scene.py.
import type { ShowSpec } from './events';

export type RuleId = 'idle' | 'solo' | 'duet' | 'showoff' | 'thunder' | 'fail' | 'song';

export interface LightRule { id: RuleId; title: string; lines: string[] }

export function lightRules(spec: ShowSpec): LightRule[] {
  const tun = (id: string) => spec.tunables?.find(t => t.id === id)?.value;
  const list = (id: string) => ([] as unknown[]).concat(tun(id) ?? []).join(' / ');
  const clicks = (game: string) => spec.games.find(g => g.id === game)?.start.clicks ?? 1;
  const intro = `3-2-1 intro, ${tun('introStepMs')} ms a step, poles ${list('polePcts')} %`;
  return [
    { id: 'idle', title: 'Idle and launch', lines: [
      'Poles: the pillar idle sequence. Stage: slow pink drift around the edge.',
      `Each press fills the presser's pole pink to ${list('launchPcts')} % for 1 / 2 / 3 taps.`,
      `The other side has ${tun('syncWindowMs')} ms to join; the decision lands ${tun('soloWaitMs')} ms after the last press.`,
    ] },
    { id: 'solo', title: `Solo · ${clicks('solo')} tap, one side`, lines: [
      `${intro}, pink, on both poles and all round; it does not matter which side pressed.`,
      `In the song: both poles glow pink, full height at ${tun('ambientGlowPct')} % (no turns in solo); pink drift all round.`,
    ] },
    { id: 'duet', title: `Duet · ${clicks('duet')}+${clicks('duet')}`, lines: [
      `${intro}, pink on both poles and the whole edge.`,
      `In the song: each pole glows (full height, ${tun('ambientGlowPct')} %) in the colour of whoever sings the section: left singer = left pole lime, right singer = right pole blue, both = both pink; the side not singing is off.`,
      'Who sings: a hand-tagged turn in the song\'s analysis, else verse 1 left, verse 2 right, …; the last section is always both. Pink drift all round.',
      `Button rings: the singer's colour, dim when not singing. At each change of singer both buttons pulse together ${tun('handoverPulses')}× over ${tun('handoverPulseMs')} ms, then show the new colours.`,
    ] },
    { id: 'showoff', title: `Showoff · ${clicks('showoff')}+${clicks('showoff')}`, lines: [
      'Intro: 3 left side lime, 2 right side blue, 1 both sweep in and merge to pink.',
      'Verses take turns: verse 1 left (lime on the left half), verse 2 right (blue), verse 3 left, …',
      `Choruses, every other section and the last section: both, pink. Poles glow (${tun('ambientGlowPct')} %) for the turn: left lime, right blue, both pink; the other side off.`,
      `At each turn change both buttons pulse together ${tun('handoverPulses')}× over ${tun('handoverPulseMs')} ms, then take the new turn's colours (dim for the side waiting).`,
    ] },
    { id: 'thunder', title: `Thunder · ${clicks('thunder')}+${clicks('thunder')}`, lines: [
      'Intro: white only. 3 left side, 2 right side, 1 the centre (catwalk).',
      'A steal loop, by the clock (not the song or its sections). Left performs first: its pole full lime, its half of the edge lime.',
      `The other pole rises 0 → 100 % in its own colour (right blue, left lime) over ${Number(tun('cooldownMs')) / 1000} s (cooldownMs).`,
      `At 100 % it flickers (fade up and down, ${tun('flickerHz')} Hz) with its button ring: steal now. No timeout.`,
      `1 tap from the flickering side = steal: ${tun('stealBlackoutMs')} ms blackout and a smoke puff, the roles swap, the cooldown restarts for the other side.`,
      `A tap before 100 % is ignored (too early${tun('stealBeforeFull') ? '; stealBeforeFull is on, so it steals' : ''}); a tap on the performer's own pole is ignored.`,
      'Button rings: each player\'s colour; the rising side\'s ring flickers with its pole. Claps (2 taps) work as in every song.',
    ] },
    { id: 'fail', title: 'Fail · counts differ', lines: [
      `Poles blink white left, right, left, right (${tun('failBlinkCount')} × ${tun('failBlinkMs')} ms), the last one fades over ${tun('failFadeMs')} ms. Edge dark. Back to idle.`,
    ] },
    { id: 'song', title: 'Appliances in every song', lines: [
      'Song start: the main sequence (here backLights and movingLights).',
      'Choruses: floodlights on. Verses: spotlights on. Other sections: both off.',
      '2 taps = claps sequence (flickers), 3 taps = special (smoke, bubbles). Stop or song end: everything off.',
    ] },
  ];
}

/** Which rules apply to the show state right now (the 'song' card applies in every game). */
export function activeRules(state: string | undefined, game: string | null | undefined): RuleId[] {
  if (state === 'failing') return ['fail'];
  if (!state || state === 'idle' || state === 'launching' || !game) return ['idle'];
  return [game as RuleId, 'song'];
}
