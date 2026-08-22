import type { Pool } from "pg";
import type {
  DeliveryRecord,
  DeliveryStore,
  TryAcquireResult,
} from "../lib/deliveryStore.js";

/**
 * Durable delivery deduplicator backed by the `webhook_deliveries` table.
 *
 * The `delivery_id` primary key is the single source of truth: INSERT ... ON
 * CONFLICT DO NOTHING both records the delivery (audit trail) and rejects
 * duplicates in one constraint. GitHub retries non-2xx responses, so this is
 * what keeps at-least-once delivery idempotent across restarts.
 */
export class PostgresDeliveryStore implements DeliveryStore {
  constructor(private readonly pool: Pool) {}

  async record(entry: DeliveryRecord): Promise<TryAcquireResult> {
    const result = await this.pool.query(
      `INSERT INTO webhook_deliveries (delivery_id, event_type, payload, received_at)
       VALUES ($1::uuid, $2, $3::jsonb, now())
       ON CONFLICT (delivery_id) DO NOTHING
       RETURNING delivery_id`,
      [entry.deliveryId, entry.event, JSON.stringify(entry.payload)],
    );
    return { accepted: (result.rowCount ?? 0) > 0 };
  }
}
