export interface DeliveryRecord {
  deliveryId: string;
  event: string;
  payload: unknown;
}

export interface TryAcquireResult {
  accepted: boolean;
}

/**
 * Delivery deduplicator. GitHub webhook delivery is at-least-once; the same
 * `X-GitHub-Delivery` id can arrive more than once. Implementations must
 * atomically claim an id so each delivery is processed exactly once.
 *
 * Production: `PostgresDeliveryStore` (INSERT ... ON CONFLICT DO NOTHING on
 * the `webhook_deliveries` primary key). In-memory is used for unit tests.
 */
export interface DeliveryStore {
  record(entry: DeliveryRecord): Promise<TryAcquireResult>;
}

/**
 * Process-local deduplicator for tests. Not durable across restarts.
 */
export class InMemoryDeliveryStore implements DeliveryStore {
  private readonly seen = new Set<string>();

  async record(entry: DeliveryRecord): Promise<TryAcquireResult> {
    if (this.seen.has(entry.deliveryId)) {
      return { accepted: false };
    }
    this.seen.add(entry.deliveryId);
    return { accepted: true };
  }

  get size(): number {
    return this.seen.size;
  }
}
