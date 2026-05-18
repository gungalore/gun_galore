export type ListingType = 'BUY_NOW' | 'TAKE_A_SHOT' | 'AUCTION';
export type ListingStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'EXPIRED';
export type Condition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
export type SellerTier = 'NEW' | 'ESTABLISHED' | 'TRUSTED' | 'TOP_SELLER' | 'DEALER';
export type Province =
  | 'EASTERN_CAPE'
  | 'FREE_STATE'
  | 'GAUTENG'
  | 'KWAZULU_NATAL'
  | 'LIMPOPO'
  | 'MPUMALANGA'
  | 'NORTH_WEST'
  | 'NORTHERN_CAPE'
  | 'WESTERN_CAPE';

export interface ListingImage {
  id: string;
  url: string;
  publicId: string;
  order: number;
  isPrimary: boolean;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  isFirearm: boolean;
  parentId: string | null;
  sortOrder: number;
}

export interface ListingSeller {
  id: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  sellerTier: SellerTier;
  totalSales: number;
  createdAt: string;
}

export interface Listing {
  id: string;
  title: string;
  description: string;
  price: number; // ZAR cents
  listingType: ListingType;
  status: ListingStatus;
  condition: Condition;
  province: Province;
  isFirearm: boolean;
  make: string | null;
  model: string | null;
  calibre: string | null;
  passFeeToBuyer: boolean;
  autoAcceptThreshold: number | null;
  categoryId: string;
  sellerId: string;
  category: Category;
  seller: ListingSeller;
  images: ListingImage[];
  createdAt: string;
  updatedAt: string;
}

export interface BrowseResponse {
  listings: Listing[];
  total: number;
  page: number;
  limit: number;
}

export type PaymentStatus = 'HELD' | 'PENDING_ADMIN_VERIFICATION' | 'RELEASED' | 'DISPUTED' | 'REFUNDED';
export type ShippingMethod = 'PUDO' | 'TCG' | 'DEALER_TRANSFER';
export type ShippingStatus = 'PENDING' | 'COLLECTED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'DELIVERY_FAILED' | 'RETURNED';

export interface Transaction {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  listingPrice: number;
  commissionZar: number;
  processingFee: number;
  passFeeToBuyer: boolean;
  buyerTotal: number;
  sellerPayout: number;
  paymentStatus: PaymentStatus;
  peachCheckoutId: string | null;
  paidAt: string | null;
  releasedAt: string | null;
  shippingMethod: ShippingMethod | null;
  shippingStatus: ShippingStatus | null;
  trackingReference: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  dealerId: string | null;
  confirmedDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
  listing: Listing;
  buyer: { firstName: string | null; lastName: string | null };
  seller: { firstName: string | null; lastName: string | null };
  dealer: { id: string; name: string; city: string } | null;
}

export interface FeeBreakdown {
  listingPrice: number;
  commissionZar: number;
  processingFee: number;
  buyerTotal: number;
  sellerPayout: number;
}

export interface Rating {
  id: string;
  transactionId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
  rater: { firstName: string | null; lastName: string | null };
  transaction: { listing: { title: string } };
}

export interface TrustDashboard {
  trustScore: number;
  sellerTier: SellerTier;
  totalSales: number;
  averageRating: number | null;
  recentRatings: Rating[];
}

export interface Message {
  id: string;
  transactionId: string;
  senderClerkId: string;
  content: string;
  wasModerated: boolean;
  readAt: string | null;
  createdAt: string;
}
