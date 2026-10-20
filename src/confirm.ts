import { randomBytes } from 'node:crypto';

export type Pending = {
  userId: number;
  chatId: number;
  summary: string;
  createdAt: number;
  action: () => Promise<string>;
};

export class Confirmations {
  private readonly queue = new Map<string, Pending>();
  constructor(private readonly maxAgeMs = 120_000) {}
  create(item: Omit<Pending, 'createdAt'>): string {
    this.purge();
    for (const [token, pending] of this.queue) {
      if (pending.userId === item.userId && pending.chatId === item.chatId) this.queue.delete(token);
    }
    const token = randomBytes(18).toString('hex');
    this.queue.set(token, { ...item, createdAt: Date.now() });
    return token;
  }
  take(token: string, userId: number, chatId: number): Pending | undefined {
    const pending = this.queue.get(token);
    if (!pending || pending.userId !== userId || pending.chatId !== chatId) return undefined;
    this.queue.delete(token); // single-use BEFORE the AWS call
    if (Date.now() - pending.createdAt >= this.maxAgeMs) return undefined;
    return pending;
  }
  cancel(token: string, userId: number, chatId: number): boolean {
    const pending = this.queue.get(token);
    if (!pending || pending.userId !== userId || pending.chatId !== chatId) return false;
    this.queue.delete(token);
    return true;
  }
  private purge() {
    for (const [k, p] of this.queue) if (Date.now() - p.createdAt >= this.maxAgeMs) this.queue.delete(k);
  }
}
