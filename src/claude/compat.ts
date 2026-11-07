/**
 * Guards against changes in Claude Code's private files.
 *
 * Many Hats reads files Claude Code doesn't document: live-session records, its identity and
 * usage cache, transcripts. Each reader reports how many records it understood. When a reader
 * keeps finding records but understands none of them, Claude Code has most likely changed that
 * format: the feature is marked degraded, the code that depends on it stops acting on it (never
 * guessing from data it can't read), and the user sees one notice saying what's off. It recovers
 * by itself as soon as records make sense again.
 */

export type Feature = 'liveSessions' | 'identity' | 'usage' | 'transcripts' | 'processWrapper';

export const FEATURE_LABELS: Record<Feature, string> = {
  liveSessions: 'which sessions are open',
  identity: 'which login each account has',
  usage: 'usage limits',
  transcripts: 'session titles',
  processWrapper: 'starting each tab on its account',
};

export interface CompatIssue {
  feature: Feature;
  detail: string;
  since: number;
}

interface Track {
  streak: number;
  detail: string;
  since?: number;
}

/** How many observations in a row with nothing understood before a feature counts as degraded. */
const THRESHOLD = 3;

export class Compat {
  private readonly tracks = new Map<Feature, Track>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Record one pass of a reader: ok records understood, bad records found but not understood.
   * A pass with nothing found at all says nothing and changes nothing.
   */
  observe(feature: Feature, ok: number, bad: number, detail = ''): void {
    if (ok === 0 && bad === 0) return;
    const track = this.tracks.get(feature) ?? { streak: 0, detail: '' };
    const wasDegraded = track.since !== undefined;
    if (ok > 0) {
      this.tracks.delete(feature);
      if (wasDegraded) this.emit();
      return;
    }
    track.streak++;
    track.detail = detail;
    if (!wasDegraded && track.streak >= THRESHOLD) {
      track.since = this.now();
      this.tracks.set(feature, track);
      this.emit();
      return;
    }
    this.tracks.set(feature, track);
  }

  isDegraded(feature: Feature): boolean {
    return this.tracks.get(feature)?.since !== undefined;
  }

  issues(): CompatIssue[] {
    const out: CompatIssue[] = [];
    for (const [feature, t] of this.tracks) {
      if (t.since !== undefined) out.push({ feature, detail: t.detail, since: t.since });
    }
    return out;
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        // a listener's failure must not stop the others
      }
    }
  }
}
