-- Per-document uncertainty, and a proportional commission credit.
--
-- 1. Transaction.zohoCommissionCreditNoteCents — the commission credit note was
--    full-refund only ("the helper isn't proportional"), so a partial refund
--    credited the buyer's platform fee but left the seller's commission fully
--    charged. The two sides of one refund disagreed. This tracks the cumulative
--    commission already credited so each refund reverses its own share.
--
-- 2. Transaction.zohoUncertainDocs — an UNCERTAIN Books outcome is per
--    DOCUMENT. One column of status for six documents meant a buyer-invoice
--    timeout also blocked the commission invoice from retrying, which is a
--    policy that punishes the wrong document.

ALTER TABLE "Transaction" ADD COLUMN "zohoCommissionCreditNoteCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Transaction" ADD COLUMN "zohoUncertainDocs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
