/**
 * Token-bucket throttle: at most `ratePerSec` acquisitions per second (burst = ratePerSec).
 * `take()` resolves immediately while tokens are available, otherwise queues FIFO.
 */
export class Throttle {
  private tokens: number;
  private last = Date.now();
  private readonly queue: (() => void)[] = [];
  private timer?: NodeJS.Timeout;

  constructor(private readonly ratePerSec: number) {
    this.tokens = ratePerSec;
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.ratePerSec, this.tokens + ((now - this.last) / 1000) * this.ratePerSec);
    this.last = now;
  }

  take(): Promise<void> {
    this.refill();
    if (this.queue.length === 0 && this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = Math.max(1, Math.ceil(((1 - this.tokens) / this.ratePerSec) * 1000));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refill();
      while (this.queue.length && this.tokens >= 1) {
        this.tokens -= 1;
        this.queue.shift()!();
      }
      if (this.queue.length) this.schedule();
    }, wait);
  }

  get pending(): number {
    return this.queue.length;
  }
}
