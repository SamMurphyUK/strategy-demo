// Port of core/rng/pcg.gd. Godot ints are signed 64-bit and the state is masked
// to 63 bits after every step, so arithmetic mod 2^63 reproduces it exactly.

const MULTIPLIER = 6364136223846793005n;
const MASK_63 = 0x7fffffffffffffffn;
const MASK_32 = 0xffffffffn;

export interface PcgSeed {
  state: number | bigint;
  sequence: number | bigint;
}

export interface PcgState {
  state: bigint;
  sequence: bigint;
}

export class PCG {
  private _state: bigint;
  private _sequence: bigint;

  constructor(pState: number | bigint, pSequence: number | bigint) {
    this._sequence = (BigInt(pSequence) << 1n) | 1n;
    this._state = 0n;
    this._advance();
    this._state = (this._state + BigInt(pState)) & MASK_63;
    this._advance();
  }

  private _advance(): void {
    this._state = (this._state * MULTIPLIER + this._sequence) & MASK_63;
  }

  nextInt(): number {
    const oldState = this._state;
    this._advance();

    const xorshifted = (((oldState >> 18n) ^ oldState) >> 27n) & MASK_32;
    const rot = (oldState >> 59n) & 0x1fn;

    let result: bigint;
    if (rot === 0n) {
      result = xorshifted;
    } else {
      result = ((xorshifted >> rot) | (xorshifted << (32n - rot))) & MASK_32;
    }
    return Number(result);
  }

  rollD6(): number {
    const maxValid = 0xffffffff - (0xffffffff % 6) - 1;
    let r = this.nextInt();
    while (r > maxValid) {
      r = this.nextInt();
    }
    return (r % 6) + 1;
  }

  getState(): PcgState {
    return { state: this._state, sequence: this._sequence };
  }

  static fromSeed(seed: PcgSeed): PCG {
    return new PCG(seed.state, seed.sequence);
  }
}
