import { Injectable, Logger } from '@nestjs/common';

export type ShippingMethod = 'PUDO' | 'TCG' | 'DEALER_TRANSFER';

// Internal status enum mirroring Prisma ShippingStatus
export type ShippingStatus =
  | 'PENDING'
  | 'COLLECTED'
  | 'IN_TRANSIT'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'RETURNED';

@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);

  /**
   * Returns allowed shipping methods for a listing.
   * Absolute rule (CLAUDE.md): firearms → DEALER_TRANSFER only.
   */
  getDeliveryOptions(isFirearm: boolean): ShippingMethod[] {
    if (isFirearm) return ['DEALER_TRANSFER'];
    return ['PUDO', 'TCG'];
  }

  // ------------------------------------------------------------------
  // TCG webhook event processing
  // Phase 4 (Payments) will wire these to Transaction records.
  // ------------------------------------------------------------------
  async processTcgEvent(event: string, payload: Record<string, unknown>): Promise<void> {
    this.logger.log(`TCG webhook event: ${event}`);

    const status = this.mapTcgStatus(event, payload);
    const waybill = payload.waybillNumber ?? payload.waybill;
    if (!waybill) {
      this.logger.warn('TCG webhook missing waybill number — ignoring');
      return;
    }

    this.logger.log(`TCG waybill ${waybill} → status ${status ?? 'unmapped'}`);
    // TODO (Phase 4): findTransactionByTrackingNumber(waybill) → update shippingStatus → notify
  }

  // ------------------------------------------------------------------
  // Pudo webhook event processing
  // ------------------------------------------------------------------
  async processPudoEvent(payload: Record<string, unknown>): Promise<void> {
    this.logger.log('Pudo webhook received');

    const status = this.mapPudoStatus(payload);
    const trackingCode = payload.trackingCode ?? payload.barcode;
    if (!trackingCode) {
      this.logger.warn('Pudo webhook missing tracking code — ignoring');
      return;
    }

    this.logger.log(`Pudo ${trackingCode} → status ${status ?? 'unmapped'}`);
    // TODO (Phase 4): findTransactionByTrackingNumber(trackingCode) → update shippingStatus → notify
  }

  // ------------------------------------------------------------------
  // Status mapping helpers
  // ------------------------------------------------------------------
  private mapTcgStatus(
    event: string,
    payload: Record<string, unknown>,
  ): ShippingStatus | null {
    // TCG event types from CLAUDE.md: shipment_note, shipment_tracking_event,
    // invoice_generated, parcel_tracking_event, shipment_file_upload.
    // TODO: verify exact status strings from TCG webhook docs.
    const statusStr = ((payload.status ?? '') as string).toLowerCase();

    if (event === 'parcel_tracking_event' || event === 'shipment_tracking_event') {
      if (statusStr.includes('collect')) return 'COLLECTED';
      if (statusStr.includes('in transit') || statusStr.includes('in_transit')) return 'IN_TRANSIT';
      if (statusStr.includes('out for delivery') || statusStr.includes('out_for_delivery')) return 'OUT_FOR_DELIVERY';
      if (statusStr.includes('delivered')) return 'DELIVERED';
      if (statusStr.includes('failed') || statusStr.includes('unsuccessful')) return 'DELIVERY_FAILED';
      if (statusStr.includes('return')) return 'RETURNED';
    }

    if (event === 'shipment_note') return 'PENDING';
    return null;
  }

  private mapPudoStatus(payload: Record<string, unknown>): ShippingStatus | null {
    const statusStr = ((payload.status ?? payload.eventCode ?? '') as string).toLowerCase();

    if (statusStr.includes('collect') || statusStr.includes('dropped')) return 'COLLECTED';
    if (statusStr.includes('in transit') || statusStr.includes('in_transit')) return 'IN_TRANSIT';
    if (statusStr.includes('ready') || statusStr.includes('out_for')) return 'OUT_FOR_DELIVERY';
    if (statusStr.includes('deliver') || statusStr.includes('collected by recipient')) return 'DELIVERED';
    if (statusStr.includes('fail') || statusStr.includes('expired')) return 'DELIVERY_FAILED';
    if (statusStr.includes('return')) return 'RETURNED';

    return null;
  }
}
