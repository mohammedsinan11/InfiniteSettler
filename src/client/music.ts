/**
 * Kleine prozedurale Fantasy-Begleitung ohne externe Audiodatei.
 *
 * Browser duerfen Audio erst nach einer Nutzerinteraktion starten. Deshalb
 * merkt sich der Controller den Wunsch sofort, erzeugt den Audiokontext aber
 * erst bei unlock(). Spaeter koennen lizenzierte Tracks dieselbe HUD-
 * Schnittstelle uebernehmen, ohne dass die Steuerung erneut gebaut wird.
 */
export class ExpeditionMusic {
  enabled = readMemory();

  private context: AudioContext | null = null;
  private phrase = 0;
  private phase: 'voyage' | 'settled' = 'voyage';

  constructor() {
    document.addEventListener('pointerdown', () => void this.unlock(), { once: true, capture: true });
    document.addEventListener('visibilitychange', () => {
      if (!this.context) return;
      if (document.hidden) void this.context.suspend();
      else if (this.enabled) void this.context.resume();
    });
  }

  setPhase(phase: 'voyage' | 'settled'): void {
    this.phase = phase;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    try { localStorage.setItem('infinite-settler-music', this.enabled ? 'on' : 'off'); } catch { /* optional */ }
    if (this.enabled) void this.unlock();
    else if (this.context) void this.context.suspend();
    return this.enabled;
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    if (!this.context) {
      this.context = new AudioContext();
      window.setInterval(() => this.playPhrase(), 4300);
      this.playPhrase();
    }
    if (this.context.state !== 'running') await this.context.resume();
  }

  private playPhrase(): void {
    const audio = this.context;
    if (!audio || !this.enabled || audio.state !== 'running' || document.hidden) return;
    const voyage = [146.83, 174.61, 220, 196, 164.81, 220];
    const settled = [164.81, 196, 246.94, 220, 196, 261.63];
    const scale = this.phase === 'voyage' ? voyage : settled;
    const now = audio.currentTime + .04;
    const root = scale[this.phrase % scale.length];
    this.note(root, now, 2.9, .025, 'triangle');
    this.note(root * 1.5, now + .82, 1.9, .014, 'sine');
    this.note(scale[(this.phrase + 2) % scale.length] * 2, now + 1.72, 1.25, .011, 'triangle');
    this.phrase++;
  }

  private note(frequency: number, at: number, duration: number, volume: number, type: OscillatorType): void {
    const audio = this.context;
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .42);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(at);
    oscillator.stop(at + duration + .05);
  }
}

function readMemory(): boolean {
  try { return localStorage.getItem('infinite-settler-music') !== 'off'; } catch { return true; }
}
