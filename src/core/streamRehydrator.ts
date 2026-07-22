import type { TokenMap } from "./types.js";
import { rehydrate } from "./tokenizer.js";

/**
 * A placeholder-in-formation at a chunk boundary can only ever look like an
 * opening `[` followed by zero or more token characters with no closing `]`
 * yet — i.e. this suffix. Anything else is safe to emit.
 */
const PARTIAL_TAIL_RE = /\[[A-Z0-9_]*$/;

/**
 * Rehydrates a *stream* of text where placeholders may be split across chunk
 * boundaries (`[EMA` in one chunk, `IL_1]` in the next). Per-chunk rehydration
 * would corrupt such splits, so this buffers the minimal trailing fragment that
 * could still become a placeholder and only rehydrates once a token is complete.
 *
 * Stateful and single-threaded by design: use one instance per output stream
 * (e.g. per `delta.content` sequence, or per streamed tool-call argument).
 */
export class StreamRehydrator {
  private buffer = "";

  constructor(
    private readonly tokenMap: TokenMap,
    /**
     * Longest fragment to hold while waiting for a token to close. No real
     * placeholder is this long, so an opening `[` followed by a long run of
     * token-ish characters (e.g. source code) is released rather than held.
     */
    private readonly maxHold = 64,
  ) {}

  /** Append a chunk and return the text now safe to emit (rehydrated). */
  push(text: string): string {
    this.buffer += text;

    const m = this.buffer.match(PARTIAL_TAIL_RE);
    let cut = this.buffer.length;
    if (m && this.buffer.length - m.index! <= this.maxHold) {
      cut = m.index!;
    }

    const flushable = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return rehydrate(flushable, this.tokenMap);
  }

  /** Emit any remaining buffered text (rehydrated). Call once at stream end. */
  flush(): string {
    const out = rehydrate(this.buffer, this.tokenMap);
    this.buffer = "";
    return out;
  }
}
