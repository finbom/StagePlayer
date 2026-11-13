import { api } from './api.js';

export interface AudioError {
  missing: boolean;
  message: string;
}

/**
 * Decodes audio files into memory (so playback starts instantly and seeking is exact),
 * keeps a small cache of decoded files, and finds durations in the background.
 */
export class AudioLibrary {
  readonly durations = new Map<string, number>();
  readonly errors = new Map<string, AudioError>();
  onChange: () => void = () => {};

  private cache = new Map<string, Promise<AudioBuffer>>();
  private scanQueue: string[] = [];
  private scanning = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly maxCached = 4,
  ) {}

  get(path: string): Promise<AudioBuffer> {
    const hit = this.cache.get(path);
    if (hit) {
      // Move to the end = most recently used.
      this.cache.delete(path);
      this.cache.set(path, hit);
      return hit;
    }
    const promise = this.decode(path);
    this.cache.set(path, promise);
    promise.catch(() => this.cache.delete(path));
    while (this.cache.size > this.maxCached) {
      const oldest = this.cache.keys().next().value as string;
      this.cache.delete(oldest);
    }
    return promise;
  }

  clearError(path: string): void {
    this.errors.delete(path);
  }

  /** Queue files whose duration is not yet known. Decoded one at a time. */
  scanDurations(paths: string[]): void {
    for (const p of paths) {
      if (!this.durations.has(p) && !this.errors.has(p) && !this.scanQueue.includes(p)) this.scanQueue.push(p);
    }
    if (!this.scanning) void this.runScan();
  }

  private async runScan(): Promise<void> {
    this.scanning = true;
    while (this.scanQueue.length) {
      const p = this.scanQueue.shift()!;
      if (this.durations.has(p) || this.errors.has(p)) continue;
      const cached = this.cache.get(p);
      await (cached ?? this.decode(p)).catch(() => undefined);
    }
    this.scanning = false;
  }

  private async decode(path: string): Promise<AudioBuffer> {
    try {
      const bytes = await api.readAudioFile(path);
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const buffer = await this.ctx.decodeAudioData(data);
      this.durations.set(path, buffer.duration);
      this.errors.delete(path);
      this.onChange();
      return buffer;
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      const error: AudioError = /ENOENT/.test(text)
        ? { missing: true, message: 'File not found' }
        : /EACCES|EPERM/.test(text)
          ? { missing: false, message: 'Permission denied' }
          : { missing: false, message: 'Unsupported or damaged audio file' };
      this.errors.set(path, error);
      this.onChange();
      throw new Error(error.message);
    }
  }
}

export type PlayState = 'stopped' | 'playing' | 'paused';

interface Voice {
  source: AudioBufferSourceNode;
  envelope: GainNode; // fades
  volume: GainNode; // per-entry volume
}

/**
 * Plays one entry at a time. Stopping fades the old sound out while the
 * player is immediately ready for the next entry.
 */
export class Player {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  state: PlayState = 'stopped';
  entryId: string | null = null;
  onEnded: (entryId: string) => void = () => {};
  onStateChange: () => void = () => {};

  private buffer: AudioBuffer | null = null;
  private voice: Voice | null = null;
  private fading = new Set<Voice>();
  private gain = 1;
  private offset = 0;
  private startedAt = 0;

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get position(): number {
    if (!this.buffer) return 0;
    if (this.state !== 'playing') return this.offset;
    return Math.min(this.buffer.duration, this.offset + this.ctx.currentTime - this.startedAt);
  }

  get isFading(): boolean {
    return this.fading.size > 0;
  }

  play(entryId: string, buffer: AudioBuffer, gain: number, offset = 0): void {
    this.release(0.02);
    this.load(entryId, buffer, gain, offset);
    this.startVoice();
    this.setState('playing');
  }

  /** Load an entry paused at a position, ready to be resumed. */
  cue(entryId: string, buffer: AudioBuffer, gain: number, offset: number): void {
    this.release(0.02);
    this.load(entryId, buffer, gain, offset);
    this.setState('paused');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.offset = this.position;
    this.release(0.03);
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused' || !this.buffer) return;
    this.startVoice();
    this.setState('playing');
  }

  seek(seconds: number): void {
    if (!this.buffer) return;
    const target = Math.max(0, Math.min(seconds, Math.max(0, this.buffer.duration - 0.05)));
    if (this.state === 'playing') {
      this.release(0.02);
      this.offset = target;
      this.startVoice();
    } else {
      this.offset = target;
    }
    this.onStateChange();
  }

  stop(fadeSeconds: number): void {
    this.release(this.state === 'playing' ? fadeSeconds : 0);
    this.buffer = null;
    this.entryId = null;
    this.offset = 0;
    this.setState('stopped');
  }

  /** Silence everything at once, including sounds that are still fading out. */
  panic(): void {
    this.stop(0);
    for (const v of this.fading) this.dispose(v, true);
    this.fading.clear();
    this.onStateChange();
  }

  setGain(gain: number): void {
    this.gain = gain;
    this.voice?.volume.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02);
  }

  private load(entryId: string, buffer: AudioBuffer, gain: number, offset: number): void {
    this.entryId = entryId;
    this.buffer = buffer;
    this.gain = gain;
    this.offset = Math.max(0, Math.min(offset, Math.max(0, buffer.duration - 0.05)));
  }

  private startVoice(): void {
    if (!this.buffer) return;
    void this.ctx.resume();
    const now = this.ctx.currentTime;
    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + 0.01); // avoid a click
    const volume = this.ctx.createGain();
    volume.gain.value = this.gain;
    source.connect(envelope).connect(volume).connect(this.ctx.destination);

    const voice: Voice = { source, envelope, volume };
    source.onended = () => {
      if (this.voice !== voice) return;
      // Played to the end.
      this.dispose(voice, false);
      this.voice = null;
      const id = this.entryId;
      this.buffer = null;
      this.entryId = null;
      this.offset = 0;
      this.setState('stopped');
      if (id) this.onEnded(id);
    };
    source.start(0, this.offset);
    this.startedAt = now;
    this.voice = voice;
  }

  /** Fade out the current voice (if any) and forget it. */
  private release(fadeSeconds: number): void {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    const now = this.ctx.currentTime;
    const fade = Math.max(0.01, fadeSeconds);
    const g = voice.envelope.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    voice.source.onended = () => {
      this.fading.delete(voice);
      this.dispose(voice, false);
      this.onStateChange();
    };
    voice.source.stop(now + fade + 0.01);
    this.fading.add(voice);
  }

  private dispose(voice: Voice, stopNow: boolean): void {
    voice.source.onended = null;
    if (stopNow) {
      try {
        voice.source.stop();
      } catch {
        // already stopped
      }
    }
    voice.source.disconnect();
    voice.envelope.disconnect();
    voice.volume.disconnect();
  }

  private setState(state: PlayState): void {
    this.state = state;
    this.onStateChange();
  }
}
