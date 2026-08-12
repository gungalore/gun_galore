-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('ADMIN', 'SUPERADMIN', 'MONITORING_ADMIN');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('BUY_NOW', 'TAKE_A_SHOT', 'AUCTION', 'SWOP');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAYMENT_PENDING', 'SOLD', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('HELD', 'PENDING_ADMIN_VERIFICATION', 'RELEASED', 'DISPUTED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "Condition" AS ENUM ('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "SellerTier" AS ENUM ('NEW', 'ESTABLISHED', 'TRUSTED', 'TOP_SELLER', 'DEALER');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'REJECTED', 'UNDER_REVIEW');

-- CreateEnum
CREATE TYPE "ClaudeDecision" AS ENUM ('APPROVE', 'AUTO_FIX_AND_APPROVE', 'REJECT', 'HUMAN_REVIEW');

-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('PUDO', 'TCG', 'DEALER_TRANSFER', 'PRIVATE_ARRANGE', 'COLLECTION', 'ON_SITE_SERVICE');

-- CreateEnum
CREATE TYPE "ShippingStatus" AS ENUM ('PENDING', 'COLLECTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'DELIVERY_FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "Province" AS ENUM ('EASTERN_CAPE', 'FREE_STATE', 'GAUTENG', 'KWAZULU_NATAL', 'LIMPOPO', 'MPUMALANGA', 'NORTH_WEST', 'NORTHERN_CAPE', 'WESTERN_CAPE');

-- CreateEnum
CREATE TYPE "ExperienceType" AS ENUM ('RANGE_DAY', 'PLAINS_GAME_HUNT');

-- CreateEnum
CREATE TYPE "ListingQuestionStatus" AS ENUM ('PENDING_MODERATION', 'REJECTED_BY_MODERATION', 'AWAITING_SELLER_ANSWER', 'AUTO_ANSWERED', 'ANSWERED_BY_SELLER', 'HIDDEN');

-- CreateEnum
CREATE TYPE "FeaturedSlotStatus" AS ENUM ('VACANT', 'AUCTION_RUNNING', 'BIND_WINDOW', 'OCCUPIED');

-- CreateEnum
CREATE TYPE "FeaturedAuctionStatus" AS ENUM ('OPEN', 'CLOSED_AWARDED', 'CLOSED_NO_BIDS', 'CANCELLED_BY_ADMIN');

-- CreateEnum
CREATE TYPE "FeaturedAuctionKind" AS ENUM ('SCHEDULED', 'AD_HOC');

-- CreateEnum
CREATE TYPE "FeaturedBidStatus" AS ENUM ('ACTIVE', 'WON', 'LOST', 'WITHDRAWN', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FeaturedTier" AS ENUM ('T1', 'T2', 'T3', 'T4', 'T5');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('BUYER', 'SELLER', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "AttributeType" AS ENUM ('NUMBER', 'SELECT', 'TEXT', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'EXTENDED', 'ENDED', 'SOLD_OUT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DealPoStatus" AS ENUM ('DRAFT', 'PLACED', 'EMAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'MEMBER', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AskGgConversationOutcome" AS ENUM ('UNRESOLVED', 'RESOLVED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "AskGgKbStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VERIFIED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PrizeDrawStatus" AS ENUM ('LIVE', 'DRAWN', 'FULFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AskGgGuideStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "ReloadingManualStatus" AS ENUM ('PROCESSING', 'ACTIVE', 'ARCHIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "HuntPdfCategory" AS ENUM ('SPECIES_GUIDE', 'CARTRIDGE_DATA', 'REGULATIONS', 'BALLISTICS_THEORY', 'HUNTING_TECHNIQUE', 'FLORA_REFERENCE', 'GENERAL');

-- CreateEnum
CREATE TYPE "HuntPdfStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'AWAITING_USER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'PAID', 'PARTIALLY_FULFILLED', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderPaymentMethod" AS ENUM ('MANUAL_EFT', 'GATEWAY');

-- CreateEnum
CREATE TYPE "SwapProposalStatus" AS ENUM ('PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('AWAITING_FUNDING', 'LOCKED', 'IN_TRANSIT', 'AWAITING_VERIFICATION', 'COMPLETED', 'CANCELLED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "SwapRole" AS ENUM ('INITIATOR_GIVES', 'OWNER_GIVES');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "campaignKey" TEXT,
    "username" TEXT,
    "phone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneOtpHash" TEXT,
    "phoneOtpExpiresAt" TIMESTAMP(3),
    "firstName" TEXT,
    "lastName" TEXT,
    "avatarUrl" TEXT,
    "addrBuilding" TEXT,
    "addrStreet" TEXT,
    "addrAddress2" TEXT,
    "addrSuburb" TEXT,
    "addrCity" TEXT,
    "addrPostalCode" TEXT,
    "addrProvince" "Province",
    "addrLat" DOUBLE PRECISION,
    "addrLng" DOUBLE PRECISION,
    "sellerTier" "SellerTier" NOT NULL DEFAULT 'NEW',
    "trustScore" INTEGER NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'NONE',
    "kycVerifiedAt" TIMESTAMP(3),
    "kycDocumentUrl" TEXT,
    "kycRequiredAt" TIMESTAMP(3),
    "kycConsentGivenAt" TIMESTAMP(3),
    "kycIdVerifiedAt" TIMESTAMP(3),
    "kycAttempts" INTEGER NOT NULL DEFAULT 0,
    "kycFaceMatchScore" DOUBLE PRECISION,
    "kycFaceMatchStatus" TEXT,
    "kycVerifyNowTransactionId" TEXT,
    "kycIdHash" TEXT,
    "idNumberEncrypted" TEXT,
    "dateOfBirth" TEXT,
    "kycIdDocumentUrl" TEXT,
    "kycSelfieUrl" TEXT,
    "kycClaudeFindings" JSONB,
    "kycHaCheckJson" JSONB,
    "kycMethod" TEXT,
    "kycTier" TEXT,
    "kycReviewedById" TEXT,
    "kycReviewedAt" TIMESTAMP(3),
    "kycReviewNote" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "privacyConsentAt" TIMESTAMP(3),
    "ageAffirmedAt" TIMESTAMP(3),
    "consentPolicyVersion" TEXT,
    "marketingConsentAt" TIMESTAMP(3),
    "totalSales" INTEGER NOT NULL DEFAULT 0,
    "isBanned" BOOLEAN NOT NULL DEFAULT false,
    "bannedAt" TIMESTAMP(3),
    "profileCompletedAt" TIMESTAMP(3),
    "bankName" TEXT,
    "bankAccountHolder" TEXT,
    "bankAccountNumber" TEXT,
    "bankBranchCode" TEXT,
    "bankAccountType" TEXT,
    "bankVerifiedAt" TIMESTAMP(3),
    "bankAvsResult" TEXT,
    "bankVerificationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "auctionStrikes" INTEGER NOT NULL DEFAULT 0,
    "lastStrikeAt" TIMESTAMP(3),
    "dispatchStrikes" INTEGER NOT NULL DEFAULT 0,
    "sellerRejectStrikes" INTEGER NOT NULL DEFAULT 0,
    "sellingBannedAt" TIMESTAMP(3),
    "zohoContactId" TEXT,
    "notifyEmailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifySmsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultWeightGrams" INTEGER,
    "defaultLengthCm" INTEGER,
    "defaultWidthCm" INTEGER,
    "defaultHeightCm" INTEGER,
    "lastLoginAt" TIMESTAMP(3),
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "peachCustomerId" TEXT,
    "isVerifiedExpert" BOOLEAN NOT NULL DEFAULT false,
    "verifiedExpertAt" TIMESTAMP(3),
    "expertBadgeReason" TEXT,
    "askGgLifetimeMessages" INTEGER NOT NULL DEFAULT 0,
    "askGgLifetimePhotoIds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "url" TEXT,
    "iconKey" TEXT,
    "linkedType" TEXT,
    "linkedId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "dismissible" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "isFirearm" BOOLEAN NOT NULL DEFAULT false,
    "publicVisible" BOOLEAN NOT NULL DEFAULT false,
    "requiresLicence" BOOLEAN NOT NULL DEFAULT false,
    "availableSecondhand" BOOLEAN NOT NULL DEFAULT true,
    "availableNewStore" BOOLEAN NOT NULL DEFAULT false,
    "crossSellEligible" BOOLEAN NOT NULL DEFAULT true,
    "collectionOnly" BOOLEAN NOT NULL DEFAULT false,
    "requiresPapers" BOOLEAN NOT NULL DEFAULT false,
    "showTestedWorkingAttestation" BOOLEAN NOT NULL DEFAULT false,
    "isExperience" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryAttribute" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL,
    "unit" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "filterable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryRelation" (
    "id" TEXT NOT NULL,
    "fromCategoryId" TEXT NOT NULL,
    "toCategoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "requireExactMatch" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CategoryRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossSellMiss" (
    "id" TEXT NOT NULL,
    "fromCategoryId" TEXT NOT NULL,
    "calibre" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrossSellMiss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT,
    "sellerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER,
    "compareAtPriceZarCents" INTEGER,
    "listingType" "ListingType" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "condition" "Condition" NOT NULL,
    "province" "Province" NOT NULL,
    "isFirearm" BOOLEAN NOT NULL DEFAULT false,
    "publicVisible" BOOLEAN NOT NULL DEFAULT false,
    "collectionOnly" BOOLEAN NOT NULL DEFAULT false,
    "requiresPapers" BOOLEAN NOT NULL DEFAULT false,
    "papersAttestedAt" TIMESTAMP(3),
    "testedWorkingAttestedAt" TIMESTAMP(3),
    "isExperience" BOOLEAN NOT NULL DEFAULT false,
    "experienceType" "ExperienceType",
    "eventStartDate" TIMESTAMP(3),
    "eventEndDate" TIMESTAMP(3),
    "eventProvince" "Province",
    "locationText" TEXT,
    "capacitySlots" INTEGER,
    "durationText" TEXT,
    "speciesList" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "whatsIncluded" TEXT,
    "rifleProvided" BOOLEAN NOT NULL DEFAULT false,
    "supplierRegistrationNumber" TEXT,
    "supplierRegistrationDocUrl" TEXT,
    "supplierInsuranceUrl" TEXT,
    "supplierAttestedAt" TIMESTAMP(3),
    "supplierDocReviewStatus" TEXT,
    "supplierDocReviewScore" DOUBLE PRECISION,
    "supplierDocReviewFindings" JSONB,
    "supplierDocReviewedAt" TIMESTAMP(3),
    "make" TEXT,
    "model" TEXT,
    "calibre" TEXT,
    "attributes" JSONB,
    "serialNumber" TEXT,
    "serialPhotoUrl" TEXT,
    "licencePhotoUrl" TEXT,
    "licenceHolderName" TEXT,
    "licenceExpiresAt" TIMESTAMP(3),
    "licenceExpiryWarnedAt" TIMESTAMP(3),
    "firearmType" TEXT,
    "weightGrams" INTEGER,
    "lengthCm" INTEGER,
    "widthCm" INTEGER,
    "heightCm" INTEGER,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "quantityAvailable" INTEGER NOT NULL DEFAULT 1,
    "quantityReserved" INTEGER NOT NULL DEFAULT 0,
    "autoAcceptThreshold" INTEGER,
    "autoDeclineThreshold" INTEGER,
    "declaredValueCents" INTEGER,
    "reservePrice" INTEGER,
    "buyNowPrice" INTEGER,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "currentBid" INTEGER,
    "currentBidderId" TEXT,
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "reserveMet" BOOLEAN NOT NULL DEFAULT false,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "durationDays" INTEGER,
    "endedAt" TIMESTAMP(3),
    "passFeeToBuyer" BOOLEAN NOT NULL DEFAULT false,
    "shippingMethods" "ShippingMethod"[] DEFAULT ARRAY[]::"ShippingMethod"[],
    "privateArrangeConsentAt" TIMESTAMP(3),
    "plannedDealerLocation" TEXT,
    "plannedDealerName" TEXT,
    "plannedDealerProvince" TEXT,
    "plannedDealerArea" TEXT,
    "pickupBuilding" TEXT,
    "pickupStreet" TEXT,
    "pickupAddress2" TEXT,
    "pickupSuburb" TEXT,
    "pickupCity" TEXT,
    "pickupPostalCode" TEXT,
    "pickupLat" DOUBLE PRECISION,
    "pickupLng" DOUBLE PRECISION,
    "pickupPudoLockerId" TEXT,
    "claudeDecision" "ClaudeDecision",
    "claudeConfidence" DOUBLE PRECISION,
    "claudeReasons" TEXT[],
    "claudeReviewedAt" TIMESTAMP(3),
    "claudeOriginalDescription" TEXT,
    "claudeAutoFixApplied" BOOLEAN NOT NULL DEFAULT false,
    "adminReviewedById" TEXT,
    "adminReviewedAt" TIMESTAMP(3),
    "adminOverrideReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "listedAt" TIMESTAMP(3),
    "priceDropNotifiedAt" TIMESTAMP(3),
    "endingSoonNotifiedAt" TIMESTAMP(3),
    "winnerRemindedAt" TIMESTAMP(3),
    "lastRenewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewalNudgedAt" TIMESTAMP(3),
    "isDealListing" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingImage" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "costPriceCents" INTEGER NOT NULL,
    "wasPriceCents" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "extendedUntil" TIMESTAMP(3),
    "dropDate" TIMESTAMP(3),
    "liveAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "soldOutAt" TIMESTAMP(3),
    "heroRank" INTEGER NOT NULL DEFAULT 0,
    "initialStock" INTEGER NOT NULL,
    "perCustomerCap" INTEGER NOT NULL DEFAULT 10,
    "shipsInDaysMin" INTEGER NOT NULL DEFAULT 3,
    "shipsInDaysMax" INTEGER NOT NULL DEFAULT 7,
    "supplierName" TEXT,
    "supplierRef" TEXT,
    "supplierId" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vatNumber" TEXT,
    "regNumber" TEXT,
    "warehouseStreet" TEXT NOT NULL,
    "warehouseSuburb" TEXT NOT NULL,
    "warehouseCity" TEXT NOT NULL,
    "warehouseProvince" "Province" NOT NULL,
    "warehousePostalCode" TEXT NOT NULL,
    "warehouseLat" DOUBLE PRECISION,
    "warehouseLng" DOUBLE PRECISION,
    "notes" TEXT,
    "zohoVendorId" TEXT,
    "zohoSyncStatus" TEXT,
    "zohoSyncError" TEXT,
    "zohoSyncLastAttemptAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealPurchaseOrder" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "unitsOrdered" INTEGER NOT NULL,
    "unitCostCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "status" "DealPoStatus" NOT NULL DEFAULT 'DRAFT',
    "zohoPurchaseOrderId" TEXT,
    "zohoSyncStatus" TEXT,
    "zohoSyncError" TEXT,
    "zohoSyncLastAttemptAt" TIMESTAMP(3),
    "placedAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "stockReadyAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealPurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dealer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licenceNumber" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "suburb" TEXT,
    "city" TEXT,
    "province" "Province",
    "postalCode" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "rawAddress" TEXT,
    "firstSeenAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dealer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "listingPrice" INTEGER NOT NULL,
    "commissionZar" INTEGER NOT NULL,
    "processingFee" INTEGER NOT NULL,
    "shippingCost" INTEGER NOT NULL DEFAULT 0,
    "shippingHandlingCents" INTEGER NOT NULL DEFAULT 0,
    "shippingServiceCode" TEXT,
    "passFeeToBuyer" BOOLEAN NOT NULL,
    "buyerTotal" INTEGER NOT NULL,
    "sellerPayout" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "riskFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "refundedAmount" INTEGER NOT NULL DEFAULT 0,
    "lastRefundAt" TIMESTAMP(3),
    "refundOfId" TEXT,
    "cancelledByBuyerAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'HELD',
    "peachCheckoutId" TEXT,
    "peachMerchantRef" TEXT,
    "peachPayoutId" TEXT,
    "peachPaymentId" TEXT,
    "peachResultCode" TEXT,
    "paidAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "paidOutAt" TIMESTAMP(3),
    "payoutHeldAt" TIMESTAMP(3),
    "payoutHoldReason" TEXT,
    "payoutHeldById" TEXT,
    "shippingMethod" "ShippingMethod",
    "shippingStatus" "ShippingStatus",
    "trackingReference" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "estimatedDeliveryAt" TIMESTAMP(3),
    "podReference" TEXT,
    "podProofUrl" TEXT,
    "pudoDropoffLockerId" TEXT,
    "pudoPickupLockerId" TEXT,
    "pudoTrackingCode" TEXT,
    "deliveryAddress" JSONB,
    "tcgWaybill" TEXT,
    "carrierShipmentId" TEXT,
    "carrierDropoffPin" TEXT,
    "shipmentBookingStartedAt" TIMESTAMP(3),
    "shipmentBookedAt" TIMESTAMP(3),
    "shipsWithId" TEXT,
    "swapId" TEXT,
    "swapRole" "SwapRole",
    "swapProofCode" TEXT,
    "swapProofPhotoUrl" TEXT,
    "swapProofStatus" TEXT,
    "swapProofScore" DOUBLE PRECISION,
    "swapProofFindings" JSONB,
    "swapProofVerifiedAt" TIMESTAMP(3),
    "dealerId" TEXT,
    "sellerKycClearedAt" TIMESTAMP(3),
    "dispatchNudgedAt" TIMESTAMP(3),
    "adminAlertedForStuckFundsAt" TIMESTAMP(3),
    "buyerConfirmNudgedAt" TIMESTAMP(3),
    "adminAlertedForTransitStallAt" TIMESTAMP(3),
    "adminAlertedForDtStallAt" TIMESTAMP(3),
    "collectionConfirmNudgedAt" TIMESTAMP(3),
    "adminAlertedForCollectionStallAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptDeadlineAt" TIMESTAMP(3),
    "acceptReminderSentAt" TIMESTAMP(3),
    "dispatchDeadlineAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "acceptEscalatedAt" TIMESTAMP(3),
    "privateArrangeAcceptedAt" TIMESTAMP(3),
    "collectionPapersAckAt" TIMESTAMP(3),
    "eventDate" TIMESTAMP(3),
    "eventEndDate" TIMESTAMP(3),
    "partySize" INTEGER,
    "experienceAttested18PlusAt" TIMESTAMP(3),
    "experienceLicenceOrSupervisionAt" TIMESTAMP(3),
    "experienceIntermediaryAckAt" TIMESTAMP(3),
    "experienceCancellationAcceptedAt" TIMESTAMP(3),
    "experienceRisksAcceptedAt" TIMESTAMP(3),
    "bookingConfirmedAt" TIMESTAMP(3),
    "bookingDeclinedAt" TIMESTAMP(3),
    "bookingDeclinedReason" TEXT,
    "bookingConfirmDeadlineAt" TIMESTAMP(3),
    "bookingConfirmNudgedAt" TIMESTAMP(3),
    "bookingConfirmEscalatedAt" TIMESTAMP(3),
    "eventCompletedConfirmedAt" TIMESTAMP(3),
    "eventPreReminderSentAt" TIMESTAMP(3),
    "eventCompletionNudgedAt" TIMESTAMP(3),
    "adminAlertedForEventUnconfirmedAt" TIMESTAMP(3),
    "cpaCancelTier" TEXT,
    "cpaAdminFeeCents" INTEGER,
    "saps534PhotoUrl" TEXT,
    "stockRegisterPhotoUrl" TEXT,
    "firearmSerialPhotoUrl" TEXT,
    "dealerVerificationStatus" TEXT,
    "dealerVerificationScore" DOUBLE PRECISION,
    "dealerVerificationFindings" JSONB,
    "dealerVerifiedAt" TIMESTAMP(3),
    "dealerVerifyAttempts" INTEGER NOT NULL DEFAULT 0,
    "dealerStockRegisterRef" TEXT,
    "stockedAtDealerName" TEXT,
    "stockedAtDealerAddress" TEXT,
    "stockedAtDealerPhone" TEXT,
    "zohoCommissionInvoiceId" TEXT,
    "zohoCommissionPaymentId" TEXT,
    "zohoCreditNoteId" TEXT,
    "zohoDealReceiptId" TEXT,
    "zohoDealCreditNoteId" TEXT,
    "zohoSyncStatus" TEXT,
    "zohoSyncError" TEXT,
    "zohoSyncLastAttemptAt" TIMESTAMP(3),
    "orderReference" TEXT,
    "manualDetectedAt" TIMESTAMP(3),
    "manualVerifiedAt" TIMESTAMP(3),
    "manualPayByAt" TIMESTAMP(3),
    "manualCancelledAt" TIMESTAMP(3),
    "manualWarn12hAt" TIMESTAMP(3),
    "manualWarn1hAt" TIMESTAMP(3),
    "adminNote" TEXT,
    "adminReviewedById" TEXT,
    "adminReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedDeliveryAt" TIMESTAMP(3),

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingEvent" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rawStatus" TEXT,
    "source" TEXT NOT NULL,
    "message" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingQuestion" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "askerId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "questionDecision" TEXT,
    "questionReason" TEXT,
    "status" "ListingQuestionStatus" NOT NULL DEFAULT 'PENDING_MODERATION',
    "answer" TEXT,
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),
    "autoAnsweredFromQuestionId" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "reportedCount" INTEGER NOT NULL DEFAULT 0,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
    "firstName" TEXT,
    "lastName" TEXT,
    "clerkId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditEvent" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAlert" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "referenceId" TEXT,
    "context" TEXT,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactDetailRejection" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sampleText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactDetailRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "raterId" TEXT NOT NULL,
    "ratedId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "sellerResponse" TEXT,
    "sellerRespondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "senderClerkId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "originalContent" TEXT,
    "wasModerated" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "offerAmount" INTEGER NOT NULL,
    "counterAmount" INTEGER,
    "buyerNote" TEXT,
    "sellerNote" TEXT,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "metAutoAccept" BOOLEAN NOT NULL DEFAULT false,
    "rejectReason" TEXT,
    "rejectNote" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "sellerRemindedAt" TIMESTAMP(3),
    "buyerPayRemindedAt" TIMESTAMP(3),
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "maxAmount" INTEGER NOT NULL,
    "isWinner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionWatch" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionWatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchedListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchedListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "q" TEXT,
    "categoryId" TEXT,
    "categorySlug" TEXT,
    "listingType" TEXT,
    "condition" TEXT,
    "province" TEXT,
    "make" TEXT,
    "minPrice" INTEGER,
    "maxPrice" INTEGER,
    "sort" TEXT,
    "attrs" TEXT,
    "fingerprint" TEXT NOT NULL,
    "notifyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "category" "NotificationCategory"[] DEFAULT ARRAY['BUYER', 'SELLER', 'ACCOUNT']::"NotificationCategory"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ReferenceCounter" (
    "prefix" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("prefix")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "headline" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartridgeSpec" (
    "cartridgeKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "grtName" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "origin" TEXT,
    "cartridgeType" TEXT,
    "year" INTEGER,
    "caseLengthMm" DOUBLE PRECISION,
    "maxCartridgeLengthMm" DOUBLE PRECISION,
    "maxPressureBar" INTEGER,
    "maxPressurePsi" INTEGER,
    "caseCapacityGrH2O" DOUBLE PRECISION,
    "officialPdfUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CartridgeSpec_pkey" PRIMARY KEY ("cartridgeKey")
);

-- CreateTable
CREATE TABLE "SmsLog" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "reference" TEXT,
    "status" TEXT NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "nextRetryAt" TIMESTAMP(3),

    CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSlot" (
    "id" TEXT NOT NULL,
    "slotNumber" INTEGER NOT NULL,
    "status" "FeaturedSlotStatus" NOT NULL DEFAULT 'VACANT',
    "currentListingId" TEXT,
    "currentSellerId" TEXT,
    "featuredUntil" TIMESTAMP(3),
    "currentAuctionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedAuction" (
    "id" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "kind" "FeaturedAuctionKind" NOT NULL,
    "status" "FeaturedAuctionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "winningBidId" TEXT,

    CONSTRAINT "FeaturedAuction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSlotBid" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "tier" "FeaturedTier" NOT NULL,
    "isBuyNow" BOOLEAN NOT NULL DEFAULT false,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "chargedAmountCents" INTEGER,
    "orderReference" TEXT,
    "pendingListingId" TEXT,
    "paymentPayByAt" TIMESTAMP(3),
    "paymentDetectedAt" TIMESTAMP(3),
    "status" "FeaturedBidStatus" NOT NULL DEFAULT 'ACTIVE',
    "peachPaymentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "cascadedFromId" TEXT,
    "zohoInvoiceId" TEXT,
    "zohoSyncStatus" TEXT,
    "zohoSyncError" TEXT,
    "zohoSyncLastAttemptAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeaturedSlotBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSlotConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "slotCount" INTEGER NOT NULL DEFAULT 10,
    "bidFloorCents" INTEGER NOT NULL DEFAULT 10000,
    "t1AmountCents" INTEGER NOT NULL DEFAULT 10000,
    "t1DurationSec" INTEGER NOT NULL DEFAULT 86400,
    "t2AmountCents" INTEGER NOT NULL DEFAULT 20000,
    "t2DurationSec" INTEGER NOT NULL DEFAULT 172800,
    "t3AmountCents" INTEGER NOT NULL DEFAULT 30000,
    "t3DurationSec" INTEGER NOT NULL DEFAULT 432000,
    "t4AmountCents" INTEGER NOT NULL DEFAULT 40000,
    "t4DurationSec" INTEGER NOT NULL DEFAULT 604800,
    "t5AmountCents" INTEGER NOT NULL DEFAULT 50000,
    "t5DurationSec" INTEGER NOT NULL DEFAULT 1209600,
    "bidWindowSec" INTEGER NOT NULL DEFAULT 86400,
    "bindWindowSec" INTEGER NOT NULL DEFAULT 900,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "FeaturedSlotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSlotBidderBan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "bannedByAdminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedSlotBidderBan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeaturedSlotAuditEvent" (
    "id" TEXT NOT NULL,
    "slotId" TEXT,
    "eventType" TEXT NOT NULL,
    "payloadJson" TEXT,
    "actorUserId" TEXT,
    "actorAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeaturedSlotAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "authorisedUserId" TEXT NOT NULL,
    "metadataJson" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "invalidAttempts" INTEGER NOT NULL DEFAULT 0,
    "consumedFromIp" TEXT,
    "consumedFromUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditSnapshot" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "balance" DOUBLE PRECISION,
    "unit" TEXT,
    "metadata" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "CreditSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditThreshold" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "warnThreshold" DOUBLE PRECISION,
    "alarmThreshold" DOUBLE PRECISION,
    "lastWarnAlertAt" TIMESTAMP(3),
    "lastAlarmAlertAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "billingCycle" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "renewalReminderAt" TIMESTAMP(3),
    "peachCustomerId" TEXT,
    "zohoCustomerId" TEXT,
    "lastChargeAt" TIMESTAMP(3),
    "failedChargeCount" INTEGER NOT NULL DEFAULT 0,
    "businessName" TEXT,
    "vatNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeDraw" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prizeValueCents" INTEGER NOT NULL,
    "imageUrls" TEXT[],
    "status" "PrizeDrawStatus" NOT NULL DEFAULT 'LIVE',
    "displayStartAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "drawAt" TIMESTAMP(3) NOT NULL,
    "drawnAt" TIMESTAMP(3),
    "winnerUserId" TEXT,
    "entrantCount" INTEGER NOT NULL DEFAULT 0,
    "drawAudit" JSONB,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilmentNote" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrizeDraw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCharge" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "peachPaymentId" TEXT,
    "zohoReceiptId" TEXT,
    "errorMessage" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "chargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderReference" TEXT,
    "payByAt" TIMESTAMP(3),
    "tierPurchased" "SubscriptionTier",
    "periodDays" INTEGER NOT NULL DEFAULT 31,
    "detectedAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskGgConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "outcome" "AskGgConversationOutcome" NOT NULL DEFAULT 'UNRESOLVED',
    "resolvedAt" TIMESTAMP(3),
    "resolvedByMatch" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AskGgConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskGgMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "imageUrls" TEXT[],
    "model" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "citations" JSONB,
    "listingCards" JSONB,
    "pageContext" JSONB,
    "ticketDraft" JSONB,
    "lane" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskGgMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskGgKbEntry" (
    "id" TEXT NOT NULL,
    "sourceConversationId" TEXT,
    "sourceKey" TEXT,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "tags" TEXT[],
    "status" "AskGgKbStatus" NOT NULL DEFAULT 'DRAFT',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "usefulCount" INTEGER NOT NULL DEFAULT 0,
    "surfacedCount" INTEGER NOT NULL DEFAULT 0,
    "embedding" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AskGgKbEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskGgGuideOverride" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intro" TEXT,
    "points" TEXT[],
    "ctas" JSONB,
    "status" "AskGgGuideStatus" NOT NULL DEFAULT 'DRAFT',
    "updatedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AskGgGuideOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AskGgUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "photoIdCount" INTEGER NOT NULL DEFAULT 0,
    "costUsdCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AskGgUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReloadingManual" (
    "id" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "edition" TEXT,
    "storedPath" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ReloadingManualStatus" NOT NULL DEFAULT 'PROCESSING',
    "ocr" BOOLEAN NOT NULL DEFAULT false,
    "uploadedByAdminId" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReloadingManual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReloadingManualPage" (
    "id" TEXT NOT NULL,
    "manualId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "extractedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReloadingManualPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualLoad" (
    "id" TEXT NOT NULL,
    "cartridge" TEXT NOT NULL,
    "cartridgeKey" TEXT NOT NULL,
    "powderMaker" TEXT NOT NULL,
    "powderName" TEXT NOT NULL,
    "bulletMaker" TEXT,
    "bulletName" TEXT,
    "bulletWeightGr" DOUBLE PRECISION NOT NULL,
    "startGr" DOUBLE PRECISION NOT NULL,
    "maxGr" DOUBLE PRECISION NOT NULL,
    "startVelFps" INTEGER,
    "maxVelFps" INTEGER,
    "fillPctStart" DOUBLE PRECISION,
    "fillPctMax" DOUBLE PRECISION,
    "coalMm" DOUBLE PRECISION,
    "primer" TEXT,
    "caseMaker" TEXT,
    "barrelLenIn" DOUBLE PRECISION,
    "notes" TEXT,
    "manualLabel" TEXT NOT NULL,
    "manualId" TEXT,
    "pageNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HuntPdf" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "edition" TEXT,
    "publisher" TEXT,
    "publishedYear" INTEGER,
    "category" "HuntPdfCategory" NOT NULL DEFAULT 'GENERAL',
    "language" TEXT NOT NULL DEFAULT 'en',
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "status" "HuntPdfStatus" NOT NULL DEFAULT 'DRAFT',
    "blurb" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HuntPdf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HuntPdfPage" (
    "id" TEXT NOT NULL,
    "pdfId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "imageBase64" TEXT,
    "imageMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HuntPdfPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RangeEstimate" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "headingDeg" DOUBLE PRECISION,
    "tiltDeg" DOUBLE PRECISION,
    "rangeM" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "species" TEXT,
    "notes" TEXT,
    "modelUsed" TEXT NOT NULL,
    "biomeId" TEXT,
    "regionCode" TEXT,
    "costUsd" DECIMAL(10,6),
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RangeEstimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "building" TEXT,
    "street" TEXT NOT NULL,
    "address2" TEXT,
    "suburb" TEXT,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "province" "Province" NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "transactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketReply" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fromAdmin" BOOLEAN NOT NULL DEFAULT false,
    "authorClerkId" TEXT,
    "adminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicketReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'BUYER',
    "category" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "transactionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedAdminId" TEXT,
    "outcome" TEXT,
    "drovePayoutHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintPhoto" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "paymentMethod" "OrderPaymentMethod" NOT NULL DEFAULT 'MANUAL_EFT',
    "orderReference" TEXT,
    "gatewayCheckoutId" TEXT,
    "gatewayPaymentId" TEXT,
    "itemsSubtotal" INTEGER NOT NULL,
    "shippingSubtotal" INTEGER NOT NULL,
    "handlingSubtotal" INTEGER NOT NULL DEFAULT 0,
    "processingFee" INTEGER NOT NULL,
    "buyerTotal" INTEGER NOT NULL,
    "manualPayByAt" TIMESTAMP(3),
    "manualDetectedAt" TIMESTAMP(3),
    "manualCancelledAt" TIMESTAMP(3),
    "manualWarn12hAt" TIMESTAMP(3),
    "manualWarn1hAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "transactionId" TEXT,
    "listingId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "lineSubtotal" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SwapProposal" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "proposerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "offeredListingId" TEXT NOT NULL,
    "cashAmount" INTEGER NOT NULL DEFAULT 0,
    "cashDirection" "SwapRole",
    "counterCashAmount" INTEGER,
    "counterCashDirection" "SwapRole",
    "proposerNote" TEXT,
    "ownerNote" TEXT,
    "status" "SwapProposalStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "swapId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SwapProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Swap" (
    "id" TEXT NOT NULL,
    "status" "SwapStatus" NOT NULL DEFAULT 'AWAITING_FUNDING',
    "initiatorId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "cashPayerId" TEXT,
    "cashAmount" INTEGER NOT NULL DEFAULT 0,
    "swapFeeInitiator" INTEGER NOT NULL DEFAULT 0,
    "swapFeeOwner" INTEGER NOT NULL DEFAULT 0,
    "cashOrderReference" TEXT,
    "gatewayCheckoutId" TEXT,
    "gatewayPaymentId" TEXT,
    "cashPayByAt" TIMESTAMP(3),
    "cashDetectedAt" TIMESTAMP(3),
    "cashVerifiedAt" TIMESTAMP(3),
    "cashCancelledAt" TIMESTAMP(3),
    "fundingSetUpAt" TIMESTAMP(3),
    "initiatorFundingRef" TEXT,
    "initiatorFundingAmount" INTEGER NOT NULL DEFAULT 0,
    "initiatorCourierCents" INTEGER NOT NULL DEFAULT 0,
    "initiatorDetectedAt" TIMESTAMP(3),
    "initiatorVerifiedAt" TIMESTAMP(3),
    "initiatorRefundedAt" TIMESTAMP(3),
    "ownerFundingRef" TEXT,
    "ownerFundingAmount" INTEGER NOT NULL DEFAULT 0,
    "ownerCourierCents" INTEGER NOT NULL DEFAULT 0,
    "ownerDetectedAt" TIMESTAMP(3),
    "ownerVerifiedAt" TIMESTAMP(3),
    "ownerRefundedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockedNotifiedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "verificationDeadlineAt" TIMESTAMP(3),
    "cashReleasedAt" TIMESTAMP(3),
    "settlementTxId" TEXT,
    "disputedAt" TIMESTAMP(3),
    "disputeReason" TEXT,
    "disputeRaisedById" TEXT,
    "zohoInitiatorFeeReceiptId" TEXT,
    "zohoOwnerFeeReceiptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Swap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "clerkId" TEXT,
    "deviceId" TEXT,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "listingId" TEXT,
    "query" TEXT,
    "resultCount" INTEGER,
    "amountCents" INTEGER,
    "path" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clerkSessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUserStats" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "logins" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "listingViews" INTEGER NOT NULL DEFAULT 0,
    "searches" INTEGER NOT NULL DEFAULT 0,
    "offers" INTEGER NOT NULL DEFAULT 0,
    "bids" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyUserStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyPlatformStats" (
    "id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "eventType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "HourlyPlatformStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightsDigest" (
    "id" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodDays" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "narrative" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightsDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkId_key" ON "User"("clerkId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_kycIdHash_key" ON "User"("kycIdHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_bankVerificationId_key" ON "User"("bankVerificationId");

-- CreateIndex
CREATE UNIQUE INDEX "User_peachCustomerId_key" ON "User"("peachCustomerId");

-- CreateIndex
CREATE INDEX "User_campaignKey_idx" ON "User"("campaignKey");

-- CreateIndex
CREATE INDEX "Notification_userId_resolvedAt_createdAt_idx" ON "Notification"("userId", "resolvedAt", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Notification_linkedType_linkedId_resolvedAt_idx" ON "Notification"("linkedType", "linkedId", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "CategoryAttribute_categoryId_isActive_sortOrder_idx" ON "CategoryAttribute"("categoryId", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryAttribute_categoryId_key_key" ON "CategoryAttribute"("categoryId", "key");

-- CreateIndex
CREATE INDEX "CategoryRelation_fromCategoryId_idx" ON "CategoryRelation"("fromCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "CategoryRelation_fromCategoryId_toCategoryId_key" ON "CategoryRelation"("fromCategoryId", "toCategoryId");

-- CreateIndex
CREATE INDEX "CrossSellMiss_count_idx" ON "CrossSellMiss"("count");

-- CreateIndex
CREATE UNIQUE INDEX "CrossSellMiss_fromCategoryId_calibre_key" ON "CrossSellMiss"("fromCategoryId", "calibre");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_referenceNumber_key" ON "Listing"("referenceNumber");

-- CreateIndex
CREATE INDEX "Listing_status_listingType_idx" ON "Listing"("status", "listingType");

-- CreateIndex
CREATE INDEX "Listing_categoryId_idx" ON "Listing"("categoryId");

-- CreateIndex
CREATE INDEX "Listing_sellerId_idx" ON "Listing"("sellerId");

-- CreateIndex
CREATE INDEX "Listing_endTime_idx" ON "Listing"("endTime");

-- CreateIndex
CREATE INDEX "Listing_status_listedAt_idx" ON "Listing"("status", "listedAt");

-- CreateIndex
CREATE INDEX "Listing_isDealListing_idx" ON "Listing"("isDealListing");

-- CreateIndex
CREATE INDEX "Listing_status_publicVisible_idx" ON "Listing"("status", "publicVisible");

-- CreateIndex
CREATE INDEX "ListingImage_listingId_idx" ON "ListingImage"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_listingId_key" ON "Deal"("listingId");

-- CreateIndex
CREATE INDEX "Deal_status_startsAt_idx" ON "Deal"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Deal_dropDate_idx" ON "Deal"("dropDate");

-- CreateIndex
CREATE INDEX "Deal_supplierId_idx" ON "Deal"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "DealPurchaseOrder_dealId_key" ON "DealPurchaseOrder"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "Dealer_licenceNumber_key" ON "Dealer"("licenceNumber");

-- CreateIndex
CREATE INDEX "Dealer_province_idx" ON "Dealer"("province");

-- CreateIndex
CREATE INDEX "Dealer_isActive_idx" ON "Dealer"("isActive");

-- CreateIndex
CREATE INDEX "Dealer_source_idx" ON "Dealer"("source");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_peachMerchantRef_key" ON "Transaction"("peachMerchantRef");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_peachPayoutId_key" ON "Transaction"("peachPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_peachPaymentId_key" ON "Transaction"("peachPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_orderReference_key" ON "Transaction"("orderReference");

-- CreateIndex
CREATE INDEX "Transaction_listingId_idx" ON "Transaction"("listingId");

-- CreateIndex
CREATE INDEX "Transaction_buyerId_idx" ON "Transaction"("buyerId");

-- CreateIndex
CREATE INDEX "Transaction_sellerId_idx" ON "Transaction"("sellerId");

-- CreateIndex
CREATE INDEX "Transaction_paymentStatus_idx" ON "Transaction"("paymentStatus");

-- CreateIndex
CREATE INDEX "Transaction_manualPayByAt_idx" ON "Transaction"("manualPayByAt");

-- CreateIndex
CREATE INDEX "Transaction_paymentStatus_paidOutAt_idx" ON "Transaction"("paymentStatus", "paidOutAt");

-- CreateIndex
CREATE INDEX "Transaction_refundOfId_idx" ON "Transaction"("refundOfId");

-- CreateIndex
CREATE INDEX "Transaction_shipsWithId_idx" ON "Transaction"("shipsWithId");

-- CreateIndex
CREATE INDEX "Transaction_shippingMethod_paymentStatus_eventDate_idx" ON "Transaction"("shippingMethod", "paymentStatus", "eventDate");

-- CreateIndex
CREATE INDEX "TrackingEvent_transactionId_idx" ON "TrackingEvent"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackingEvent_transactionId_status_occurredAt_key" ON "TrackingEvent"("transactionId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "ListingQuestion_listingId_status_idx" ON "ListingQuestion"("listingId", "status");

-- CreateIndex
CREATE INDEX "ListingQuestion_askerId_idx" ON "ListingQuestion"("askerId");

-- CreateIndex
CREATE INDEX "ListingQuestion_answeredByUserId_idx" ON "ListingQuestion"("answeredByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_clerkId_key" ON "AdminUser"("clerkId");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_adminUserId_createdAt_idx" ON "AdminAuditEvent"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_resourceType_resourceId_idx" ON "AdminAuditEvent"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_createdAt_idx" ON "AdminAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAlert_type_idx" ON "AdminAlert"("type");

-- CreateIndex
CREATE INDEX "AdminAlert_resolved_idx" ON "AdminAlert"("resolved");

-- CreateIndex
CREATE INDEX "ContactDetailRejection_userId_createdAt_idx" ON "ContactDetailRejection"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ContactDetailRejection_createdAt_idx" ON "ContactDetailRejection"("createdAt");

-- CreateIndex
CREATE INDEX "ContactDetailRejection_category_idx" ON "ContactDetailRejection"("category");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_transactionId_key" ON "Rating"("transactionId");

-- CreateIndex
CREATE INDEX "Rating_ratedId_idx" ON "Rating"("ratedId");

-- CreateIndex
CREATE INDEX "Message_transactionId_createdAt_idx" ON "Message"("transactionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_transactionId_key" ON "Offer"("transactionId");

-- CreateIndex
CREATE INDEX "Offer_listingId_idx" ON "Offer"("listingId");

-- CreateIndex
CREATE INDEX "Offer_buyerId_idx" ON "Offer"("buyerId");

-- CreateIndex
CREATE INDEX "Offer_status_idx" ON "Offer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_listingId_buyerId_key" ON "Offer"("listingId", "buyerId");

-- CreateIndex
CREATE INDEX "Bid_listingId_createdAt_idx" ON "Bid"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "Bid_bidderId_idx" ON "Bid"("bidderId");

-- CreateIndex
CREATE INDEX "AuctionWatch_userId_idx" ON "AuctionWatch"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuctionWatch_listingId_userId_key" ON "AuctionWatch"("listingId", "userId");

-- CreateIndex
CREATE INDEX "WatchedListing_userId_createdAt_idx" ON "WatchedListing"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WatchedListing_listingId_idx" ON "WatchedListing"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchedListing_userId_listingId_key" ON "WatchedListing"("userId", "listingId");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_createdAt_idx" ON "SavedSearch"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "SavedSearch_notifyEnabled_idx" ON "SavedSearch"("notifyEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_userId_fingerprint_key" ON "SavedSearch"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "EmailOutbox_nextAttemptAt_idx" ON "EmailOutbox"("nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingCampaign_key_key" ON "MarketingCampaign"("key");

-- CreateIndex
CREATE INDEX "SmsLog_reference_idx" ON "SmsLog"("reference");

-- CreateIndex
CREATE INDEX "SmsLog_createdAt_idx" ON "SmsLog"("createdAt");

-- CreateIndex
CREATE INDEX "SmsLog_status_nextRetryAt_idx" ON "SmsLog"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedSlot_slotNumber_key" ON "FeaturedSlot"("slotNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedSlot_currentListingId_key" ON "FeaturedSlot"("currentListingId");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedSlot_currentAuctionId_key" ON "FeaturedSlot"("currentAuctionId");

-- CreateIndex
CREATE INDEX "FeaturedSlot_status_idx" ON "FeaturedSlot"("status");

-- CreateIndex
CREATE INDEX "FeaturedSlot_featuredUntil_idx" ON "FeaturedSlot"("featuredUntil");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedAuction_winningBidId_key" ON "FeaturedAuction"("winningBidId");

-- CreateIndex
CREATE INDEX "FeaturedAuction_slotId_status_idx" ON "FeaturedAuction"("slotId", "status");

-- CreateIndex
CREATE INDEX "FeaturedAuction_closesAt_idx" ON "FeaturedAuction"("closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedSlotBid_orderReference_key" ON "FeaturedSlotBid"("orderReference");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedSlotBid_cascadedFromId_key" ON "FeaturedSlotBid"("cascadedFromId");

-- CreateIndex
CREATE INDEX "FeaturedSlotBid_auctionId_amountCents_idx" ON "FeaturedSlotBid"("auctionId", "amountCents");

-- CreateIndex
CREATE INDEX "FeaturedSlotBid_bidderId_status_idx" ON "FeaturedSlotBid"("bidderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FeaturedSlotBidderBan_userId_key" ON "FeaturedSlotBidderBan"("userId");

-- CreateIndex
CREATE INDEX "FeaturedSlotAuditEvent_slotId_createdAt_idx" ON "FeaturedSlotAuditEvent"("slotId", "createdAt");

-- CreateIndex
CREATE INDEX "FeaturedSlotAuditEvent_eventType_createdAt_idx" ON "FeaturedSlotAuditEvent"("eventType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionToken_token_key" ON "ActionToken"("token");

-- CreateIndex
CREATE INDEX "ActionToken_authorisedUserId_expiresAt_idx" ON "ActionToken"("authorisedUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "ActionToken_targetType_targetId_idx" ON "ActionToken"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ActionToken_expiresAt_idx" ON "ActionToken"("expiresAt");

-- CreateIndex
CREATE INDEX "CreditSnapshot_service_fetchedAt_idx" ON "CreditSnapshot"("service", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditThreshold_service_key" ON "CreditThreshold"("service");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "PrizeDraw_status_drawAt_idx" ON "PrizeDraw"("status", "drawAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCharge_orderReference_key" ON "SubscriptionCharge"("orderReference");

-- CreateIndex
CREATE INDEX "SubscriptionCharge_subscriptionId_chargedAt_idx" ON "SubscriptionCharge"("subscriptionId", "chargedAt" DESC);

-- CreateIndex
CREATE INDEX "SubscriptionCharge_status_payByAt_idx" ON "SubscriptionCharge"("status", "payByAt");

-- CreateIndex
CREATE INDEX "AskGgConversation_userId_updatedAt_idx" ON "AskGgConversation"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "AskGgMessage_conversationId_createdAt_idx" ON "AskGgMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AskGgKbEntry_sourceConversationId_key" ON "AskGgKbEntry"("sourceConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "AskGgKbEntry_sourceKey_key" ON "AskGgKbEntry"("sourceKey");

-- CreateIndex
CREATE INDEX "AskGgKbEntry_status_verifiedAt_idx" ON "AskGgKbEntry"("status", "verifiedAt" DESC);

-- CreateIndex
CREATE INDEX "AskGgKbEntry_category_idx" ON "AskGgKbEntry"("category");

-- CreateIndex
CREATE UNIQUE INDEX "AskGgGuideOverride_key_key" ON "AskGgGuideOverride"("key");

-- CreateIndex
CREATE INDEX "AskGgGuideOverride_status_idx" ON "AskGgGuideOverride"("status");

-- CreateIndex
CREATE INDEX "AskGgUsage_day_idx" ON "AskGgUsage"("day");

-- CreateIndex
CREATE UNIQUE INDEX "AskGgUsage_userId_day_key" ON "AskGgUsage"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "ReloadingManual_storedPath_key" ON "ReloadingManual"("storedPath");

-- CreateIndex
CREATE INDEX "ReloadingManual_status_manufacturer_idx" ON "ReloadingManual"("status", "manufacturer");

-- CreateIndex
CREATE INDEX "ReloadingManualPage_manualId_pageNumber_idx" ON "ReloadingManualPage"("manualId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReloadingManualPage_manualId_pageNumber_key" ON "ReloadingManualPage"("manualId", "pageNumber");

-- CreateIndex
CREATE INDEX "ManualLoad_cartridgeKey_bulletWeightGr_idx" ON "ManualLoad"("cartridgeKey", "bulletWeightGr");

-- CreateIndex
CREATE INDEX "ManualLoad_manualId_idx" ON "ManualLoad"("manualId");

-- CreateIndex
CREATE UNIQUE INDEX "ManualLoad_dedup_key" ON "ManualLoad"("manualLabel", "pageNumber", "powderName", "bulletMaker", "bulletName", "bulletWeightGr", "startGr", "maxGr");

-- CreateIndex
CREATE INDEX "HuntPdf_status_category_sortOrder_idx" ON "HuntPdf"("status", "category", "sortOrder");

-- CreateIndex
CREATE INDEX "HuntPdfPage_pdfId_pageNumber_idx" ON "HuntPdfPage"("pdfId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HuntPdfPage_pdfId_pageNumber_key" ON "HuntPdfPage"("pdfId", "pageNumber");

-- CreateIndex
CREATE INDEX "RangeEstimate_deviceId_createdAt_idx" ON "RangeEstimate"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "RangeEstimate_biomeId_createdAt_idx" ON "RangeEstimate"("biomeId", "createdAt");

-- CreateIndex
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

-- CreateIndex
CREATE INDEX "Address_userId_isDefault_idx" ON "Address"("userId", "isDefault");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_createdAt_idx" ON "SupportTicket"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketReply_ticketId_createdAt_idx" ON "SupportTicketReply"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_referenceNumber_key" ON "Complaint"("referenceNumber");

-- CreateIndex
CREATE INDEX "Complaint_userId_createdAt_idx" ON "Complaint"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_transactionId_idx" ON "Complaint"("transactionId");

-- CreateIndex
CREATE INDEX "ComplaintPhoto_complaintId_idx" ON "ComplaintPhoto"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_orderReference_key" ON "Order"("orderReference");

-- CreateIndex
CREATE UNIQUE INDEX "Order_gatewayPaymentId_key" ON "Order"("gatewayPaymentId");

-- CreateIndex
CREATE INDEX "Order_buyerId_status_idx" ON "Order"("buyerId", "status");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_manualPayByAt_idx" ON "Order"("status", "manualPayByAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLineItem_transactionId_key" ON "OrderLineItem"("transactionId");

-- CreateIndex
CREATE INDEX "OrderLineItem_orderId_idx" ON "OrderLineItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_listingId_idx" ON "OrderLineItem"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "SwapProposal_swapId_key" ON "SwapProposal"("swapId");

-- CreateIndex
CREATE INDEX "SwapProposal_listingId_idx" ON "SwapProposal"("listingId");

-- CreateIndex
CREATE INDEX "SwapProposal_proposerId_idx" ON "SwapProposal"("proposerId");

-- CreateIndex
CREATE INDEX "SwapProposal_ownerId_idx" ON "SwapProposal"("ownerId");

-- CreateIndex
CREATE INDEX "SwapProposal_status_idx" ON "SwapProposal"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SwapProposal_listingId_proposerId_key" ON "SwapProposal"("listingId", "proposerId");

-- CreateIndex
CREATE UNIQUE INDEX "Swap_cashOrderReference_key" ON "Swap"("cashOrderReference");

-- CreateIndex
CREATE UNIQUE INDEX "Swap_gatewayPaymentId_key" ON "Swap"("gatewayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Swap_initiatorFundingRef_key" ON "Swap"("initiatorFundingRef");

-- CreateIndex
CREATE UNIQUE INDEX "Swap_ownerFundingRef_key" ON "Swap"("ownerFundingRef");

-- CreateIndex
CREATE INDEX "Swap_initiatorId_status_idx" ON "Swap"("initiatorId", "status");

-- CreateIndex
CREATE INDEX "Swap_ownerId_status_idx" ON "Swap"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Swap_status_cashPayByAt_idx" ON "Swap"("status", "cashPayByAt");

-- CreateIndex
CREATE INDEX "UserEvent_createdAt_idx" ON "UserEvent"("createdAt");

-- CreateIndex
CREATE INDEX "UserEvent_userId_createdAt_idx" ON "UserEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserEvent_eventType_createdAt_idx" ON "UserEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "UserEvent_clerkId_createdAt_idx" ON "UserEvent"("clerkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LoginEvent_clerkSessionId_key" ON "LoginEvent"("clerkSessionId");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_startedAt_idx" ON "LoginEvent"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "DailyUserStats_day_idx" ON "DailyUserStats"("day");

-- CreateIndex
CREATE INDEX "DailyUserStats_userId_day_idx" ON "DailyUserStats"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUserStats_day_userId_key" ON "DailyUserStats"("day", "userId");

-- CreateIndex
CREATE INDEX "HourlyPlatformStats_hour_idx" ON "HourlyPlatformStats"("hour");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyPlatformStats_hour_eventType_key" ON "HourlyPlatformStats"("hour", "eventType");

-- CreateIndex
CREATE INDEX "InsightsDigest_generatedAt_idx" ON "InsightsDigest"("generatedAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRelation" ADD CONSTRAINT "CategoryRelation_fromCategoryId_fkey" FOREIGN KEY ("fromCategoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryRelation" ADD CONSTRAINT "CategoryRelation_toCategoryId_fkey" FOREIGN KEY ("toCategoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_currentBidderId_fkey" FOREIGN KEY ("currentBidderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingImage" ADD CONSTRAINT "ListingImage_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealPurchaseOrder" ADD CONSTRAINT "DealPurchaseOrder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_refundOfId_fkey" FOREIGN KEY ("refundOfId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_shipsWithId_fkey" FOREIGN KEY ("shipsWithId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "Swap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_dealerId_fkey" FOREIGN KEY ("dealerId") REFERENCES "Dealer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingQuestion" ADD CONSTRAINT "ListingQuestion_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingQuestion" ADD CONSTRAINT "ListingQuestion_askerId_fkey" FOREIGN KEY ("askerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingQuestion" ADD CONSTRAINT "ListingQuestion_answeredByUserId_fkey" FOREIGN KEY ("answeredByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingQuestion" ADD CONSTRAINT "ListingQuestion_autoAnsweredFromQuestionId_fkey" FOREIGN KEY ("autoAnsweredFromQuestionId") REFERENCES "ListingQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditEvent" ADD CONSTRAINT "AdminAuditEvent_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactDetailRejection" ADD CONSTRAINT "ContactDetailRejection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_raterId_fkey" FOREIGN KEY ("raterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_ratedId_fkey" FOREIGN KEY ("ratedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionWatch" ADD CONSTRAINT "AuctionWatch_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionWatch" ADD CONSTRAINT "AuctionWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchedListing" ADD CONSTRAINT "WatchedListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchedListing" ADD CONSTRAINT "WatchedListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlot" ADD CONSTRAINT "FeaturedSlot_currentListingId_fkey" FOREIGN KEY ("currentListingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlot" ADD CONSTRAINT "FeaturedSlot_currentSellerId_fkey" FOREIGN KEY ("currentSellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlot" ADD CONSTRAINT "FeaturedSlot_currentAuctionId_fkey" FOREIGN KEY ("currentAuctionId") REFERENCES "FeaturedAuction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedAuction" ADD CONSTRAINT "FeaturedAuction_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "FeaturedSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedAuction" ADD CONSTRAINT "FeaturedAuction_winningBidId_fkey" FOREIGN KEY ("winningBidId") REFERENCES "FeaturedSlotBid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlotBid" ADD CONSTRAINT "FeaturedSlotBid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "FeaturedAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlotBid" ADD CONSTRAINT "FeaturedSlotBid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlotBid" ADD CONSTRAINT "FeaturedSlotBid_cascadedFromId_fkey" FOREIGN KEY ("cascadedFromId") REFERENCES "FeaturedSlotBid"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeaturedSlotAuditEvent" ADD CONSTRAINT "FeaturedSlotAuditEvent_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "FeaturedSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionToken" ADD CONSTRAINT "ActionToken_authorisedUserId_fkey" FOREIGN KEY ("authorisedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeDraw" ADD CONSTRAINT "PrizeDraw_winnerUserId_fkey" FOREIGN KEY ("winnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCharge" ADD CONSTRAINT "SubscriptionCharge_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskGgConversation" ADD CONSTRAINT "AskGgConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskGgMessage" ADD CONSTRAINT "AskGgMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AskGgConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskGgKbEntry" ADD CONSTRAINT "AskGgKbEntry_sourceConversationId_fkey" FOREIGN KEY ("sourceConversationId") REFERENCES "AskGgConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskGgKbEntry" ADD CONSTRAINT "AskGgKbEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AskGgUsage" ADD CONSTRAINT "AskGgUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadingManual" ADD CONSTRAINT "ReloadingManual_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReloadingManualPage" ADD CONSTRAINT "ReloadingManualPage_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "ReloadingManual"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualLoad" ADD CONSTRAINT "ManualLoad_manualId_fkey" FOREIGN KEY ("manualId") REFERENCES "ReloadingManual"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HuntPdfPage" ADD CONSTRAINT "HuntPdfPage_pdfId_fkey" FOREIGN KEY ("pdfId") REFERENCES "HuntPdf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketReply" ADD CONSTRAINT "SupportTicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintPhoto" ADD CONSTRAINT "ComplaintPhoto_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLineItem" ADD CONSTRAINT "OrderLineItem_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_proposerId_fkey" FOREIGN KEY ("proposerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_offeredListingId_fkey" FOREIGN KEY ("offeredListingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SwapProposal" ADD CONSTRAINT "SwapProposal_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "Swap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

