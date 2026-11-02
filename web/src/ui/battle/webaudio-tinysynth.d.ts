declare module "webaudio-tinysynth" {
  export default class WebAudioTinySynth {
    constructor(opt?: { useReverb?: number; quality?: number; voices?: number });
    setMasterVol(v?: number): void;
    setReverbLev(v?: number): void;
    setLoop(f: number): void;
    loadMIDI(data: ArrayBuffer): void;
    playMIDI(): void;
    stopMIDI(): void;
    locateMIDI(tick: number): void;
    getPlayStatus(): { play: number; curTick: number; maxTick: number };
    getAudioContext(): AudioContext;
    setAudioContext(ctx: AudioContext, dest?: AudioNode): void;
  }
}
