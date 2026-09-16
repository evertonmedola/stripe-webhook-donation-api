import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface AuditLogEntry {
  eventId?: string;
  orderId?: string;
  eventType?: string;
  status?: string;
  reason?: string;
  action: string;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly dataSource: DataSource) {}

  async record(entry: AuditLogEntry): Promise<void> {
    try {
      const detail: Record<string, unknown> = {};
      if (entry.eventId !== undefined) detail.event_id = entry.eventId;
      if (entry.eventType !== undefined) detail.event_type = entry.eventType;
      if (entry.orderId !== undefined) detail.order_id = entry.orderId;
      if (entry.status !== undefined) detail.status = entry.status;
      if (entry.reason !== undefined) detail.reason = entry.reason;

      await this.dataSource.query(
        `INSERT INTO audit_log (event_id, order_id, action, detail) VALUES ($1, $2, $3, $4)`,
        [entry.eventId ?? null, entry.orderId ?? null, entry.action, detail],
      );
    } catch (err) {
      this.logger.error(
        `audit_log write failed (best-effort, not fatal): action=${entry?.action} error=${(err as Error).message}`,
      );
    }
  }
}
