import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Aggregates a user's shipment-relevant transactions (as BUYER = incoming,
// as SELLER = outgoing) for the account Shipping module: courier status +
// tracking, and firearm hand-off (dealer-transfer dealer details /
// private-arrangement contact). Contact + dealer reveal is gated exactly
// like the per-transaction page (paid + consented) so nothing leaks.

export interface ShipmentView {
  transactionId: string;
  role: 'incoming' | 'outgoing';
  listingId: string;
  listingTitle: string;
  imageUrl: string | null;
  isFirearm: boolean;
  method: string; // ShippingMethod
  status: string | null; // ShippingStatus
  trackingReference: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  // Seller-only, courier: the drop-off / locker PIN they hand over with.
  dropoffPin: string | null;
  // Counterparty label — USERNAME only for courier rows (no contact needed).
  counterparty: string;
  // DEALER_TRANSFER: the receiving dealer (once nominated), else the seller's
  // planned-dealer hint.
  dealer: {
    confirmed: boolean;
    name: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    licenceNumber: string | null;
  } | null;
  // PRIVATE_ARRANGE: the other party's contact to coordinate the dealer meet,
  // revealed only once paid + (for the seller's details) the seller consented.
  contact:
    | { revealed: true; name: string; phone: string | null; email: string | null }
    | { revealed: false; reason: string }
    | null;
}

@Injectable()
export class MyShipmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async myShipments(
    clerkId: string,
  ): Promise<{ incoming: ShipmentView[]; outgoing: ShipmentView[] }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { id: true },
    });
    if (!user) return { incoming: [], outgoing: [] };

    const txs = await this.prisma.transaction.findMany({
      where: {
        OR: [{ buyerId: user.id }, { sellerId: user.id }],
        paidAt: { not: null },
        paymentStatus: { notIn: ['REFUNDED'] },
        shippingMethod: {
          in: ['PUDO', 'TCG', 'DEALER_TRANSFER', 'PRIVATE_ARRANGE', 'COLLECTION'],
        },
      },
      orderBy: [{ deliveredAt: 'asc' }, { paidAt: 'desc' }],
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        shippingMethod: true,
        shippingStatus: true,
        trackingReference: true,
        dispatchedAt: true,
        deliveredAt: true,
        carrierDropoffPin: true,
        paidAt: true,
        privateArrangeAcceptedAt: true,
        listing: {
          select: {
            id: true,
            title: true,
            category: { select: { isFirearm: true } },
            plannedDealerName: true,
            plannedDealerLocation: true,
            privateArrangeConsentAt: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
        buyer: {
          select: { username: true, firstName: true, lastName: true, phone: true, email: true },
        },
        seller: {
          select: { username: true, firstName: true, lastName: true, phone: true, email: true },
        },
        dealer: {
          select: {
            name: true,
            address: true,
            suburb: true,
            city: true,
            province: true,
            phone: true,
            email: true,
            licenceNumber: true,
          },
        },
      },
    });

    const incoming: ShipmentView[] = [];
    const outgoing: ShipmentView[] = [];

    for (const tx of txs) {
      const isBuyer = tx.buyerId === user.id;
      const role: 'incoming' | 'outgoing' = isBuyer ? 'incoming' : 'outgoing';
      const other = isBuyer ? tx.seller : tx.buyer;
      const method = tx.shippingMethod ?? 'COLLECTION';

      const view: ShipmentView = {
        transactionId: tx.id,
        role,
        listingId: tx.listing.id,
        listingTitle: tx.listing.title,
        imageUrl: tx.listing.images[0]?.url ?? null,
        isFirearm: tx.listing.category?.isFirearm ?? false,
        method,
        status: tx.shippingStatus,
        trackingReference: tx.trackingReference,
        dispatchedAt: tx.dispatchedAt?.toISOString() ?? null,
        deliveredAt: tx.deliveredAt?.toISOString() ?? null,
        // Only the SELLER needs the drop PIN (they hand the parcel over).
        dropoffPin: !isBuyer ? tx.carrierDropoffPin : null,
        counterparty: other?.username ?? (isBuyer ? 'Seller' : 'Buyer'),
        dealer: null,
        contact: null,
      };

      if (method === 'DEALER_TRANSFER') {
        if (tx.dealer) {
          const addr =
            tx.dealer.address ??
            ([tx.dealer.suburb, tx.dealer.city, tx.dealer.province]
              .filter(Boolean)
              .join(', ') ||
              null);
          view.dealer = {
            confirmed: true,
            name: tx.dealer.name,
            address: addr,
            phone: tx.dealer.phone,
            email: tx.dealer.email,
            licenceNumber: tx.dealer.licenceNumber,
          };
        } else {
          // No dealer nominated yet — surface the seller's planned-dealer hint.
          view.dealer = {
            confirmed: false,
            name: tx.listing.plannedDealerName ?? tx.listing.plannedDealerLocation,
            address: tx.listing.plannedDealerLocation,
            phone: null,
            email: null,
            licenceNumber: null,
          };
        }
      }

      if (method === 'PRIVATE_ARRANGE') {
        const paid = !!tx.paidAt && !!tx.privateArrangeAcceptedAt;
        // The buyer may only see the SELLER's contact once the seller
        // consented (listing.privateArrangeConsentAt). The seller may see the
        // BUYER's contact once the buyer opted into private arrangement
        // (privateArrangeAcceptedAt) — which is what makes this method live.
        const sellerConsented = !!tx.listing.privateArrangeConsentAt;
        if (!paid) {
          view.contact = {
            revealed: false,
            reason: 'Contact is shared once the sale is paid.',
          };
        } else if (isBuyer && !sellerConsented) {
          view.contact = {
            revealed: false,
            reason:
              'The seller hasn’t shared their contact for this transfer — please arrange via support.',
          };
        } else {
          const name =
            [other?.firstName, other?.lastName].filter(Boolean).join(' ') ||
            other?.username ||
            (isBuyer ? 'Seller' : 'Buyer');
          view.contact = {
            revealed: true,
            name,
            phone: other?.phone ?? null,
            email: other?.email ?? null,
          };
        }
      }

      (isBuyer ? incoming : outgoing).push(view);
    }

    return { incoming, outgoing };
  }
}
