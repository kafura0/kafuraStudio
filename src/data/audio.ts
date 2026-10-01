/**
 * THE ZANZA AUDIO LIBRARY.
 *
 * Every entry ships with `src: null`. That is deliberate and honest: the audio
 * *pipeline* is implemented (assets are placeable on the timeline, they play through
 * the Web Audio API, and they are mixed into the exported video), but no voice
 * recordings or music cues exist yet, because those are a production task rather than
 * an engineering one. See docs/MVP.md — audio is listed as out of MVP scope for
 * content, in scope for mechanism.
 *
 * The declared durations are the authored timing estimates, so the timeline can be
 * laid out against real dialogue lengths before anyone records a word.
 */

import type { AudioDef } from '../core/types';

function slot(
  id: string,
  name: string,
  kind: AudioDef['kind'],
  duration: number,
  tags: string[],
): AudioDef {
  return { id, name, kind, src: null, srcKind: null, duration, tags };
}

export const AUDIO: AudioDef[] = [
  // --- EP001 pilot dialogue, in cut order -----------------------------
  slot('audio.ep001.nia.line1', 'NIA — "Bro, where have you been?"', 'dialogue', 1.8, ['ep001', 'nia', 'line1']),
  slot('audio.ep001.kito.line1', 'KITO — "Building my empire."', 'dialogue', 1.6, ['ep001', 'kito', 'line1']),
  slot('audio.ep001.nia.line2', 'NIA — "You owe me rent."', 'dialogue', 1.5, ['ep001', 'nia', 'line2']),
  slot('audio.ep001.kito.line2', 'KITO — "...the empire is still in development."', 'dialogue', 2.4, ['ep001', 'kito', 'line2']),

  // --- recurring sound effects ----------------------------------------
  slot('audio.sfx.door_open', 'Door open', 'sfx', 0.7, ['door']),
  slot('audio.sfx.door_slam', 'Door slam', 'sfx', 0.5, ['door', 'impact']),
  slot('audio.sfx.phone_buzz', 'Phone buzz', 'sfx', 0.6, ['phone']),
  slot('audio.sfx.couch_sit', 'Couch sit', 'sfx', 0.4, ['furniture']),
  slot('audio.sfx.matatu_pass', 'Matatu passes', 'sfx', 3.2, ['street', 'vehicle']),

  // --- music and ambience ---------------------------------------------
  slot('audio.music.ep001.opening', 'EP001 opening cue', 'music', 24, ['ep001', 'cue']),
  slot('audio.music.ep001.sting_rent', 'Rent sting', 'music', 1.8, ['ep001', 'sting', 'comedy']),
  slot('audio.ambience.apartment', "Nia's Apartment ambience", 'ambience', 60, ['apartment', 'loop']),
  slot('audio.ambience.street', 'Zanza Street ambience', 'ambience', 60, ['street', 'loop']),
  slot('audio.ambience.lounge', 'Zanza Lounge ambience', 'ambience', 60, ['lounge', 'loop']),
];
