// What every light does in each mode, in words, for the emulator's rules panel. Numbers come from the
// spec's tunables; the rules themselves mirror backend show/events.py, thunder.py and scene.py.
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
      `${intro}, pink, only on the presser's side (pole and that half of the edge).`,
      'In the song: poles off, pink drift all round.',
    ] },
    { id: 'duet', title: `Duet · ${clicks('duet')}+${clicks('duet')}`, lines: [
      `${intro}, pink on both poles and the whole edge.`,
      'In the song: poles off, pink drift all round.',
    ] },
    { id: 'showoff', title: `Showoff · ${clicks('showoff')}+${clicks('showoff')}`, lines: [
      'Intro: 3 left side lime, 2 right side blue, 1 both sweep in and merge to pink.',
      'Verses take turns: verse 1 left (lime on the left half), verse 2 right (blue), verse 3 left, …',
      'Choruses, every other section and the last section: both, pink. Poles stay off.',
    ] },
    { id: 'thunder', title: `Thunder · ${clicks('thunder')}+${clicks('thunder')}`, lines: [
      'Intro: white only. 3 left side, 2 right side, 1 the centre (catwalk).',
      'At the end of verses 2 … second-to-last: one pole, picked at random, is active, the other dark.',
      `Build: active pole climbs white over ${tun('countdownBeats')} beats. Rush, last ${tun('rushBeats')} beats: keeps climbing and pulses.`,
      `Open: 100 % white at the verse change, then drains over the window (${tun('windowBeatsShort')} beats, or ${tun('windowBeatsLong')} if that is under ${tun('minWindowMs')} ms).`,
      '1 tap on the active pole in the window = tag: half-beat blackout on the beat, then a new white look, smoke puff.',
      `Too early (before the change − ${tun('graceMs')} ms) = the pole falls to 0 in ${tun('earlyFallMs')} ms and a white halo for ${tun('flareBars')} bar; window cancelled.`,
      'Only the dark pole can clap during a countdown or window.',
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
