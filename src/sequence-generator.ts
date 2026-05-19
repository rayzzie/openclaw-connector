export class SequenceGenerator {
  private readonly sequences = new Map<string, number>();

  next(requestId: string, responseId: string): number {
    const key = `${requestId}:${responseId}`;
    const value = (this.sequences.get(key) ?? 0) + 1;
    this.sequences.set(key, value);
    return value;
  }
}
