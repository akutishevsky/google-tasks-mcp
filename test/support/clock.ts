export class TestClock {
  private t = Date.UTC(2026, 9, 17);
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}
