/**
 * THE DESK — the order book.
 *
 * 🚨 THIS IS NOT lib/desk-order.ts. One character apart, two different units.
 * `desk-order` (singular) wraps GET /admin/transactions/:id/dossier — ONE SALE,
 * the thing the Order drawer renders and the five money levers act on. This
 * file wraps GET /admin/orders — the CART PARENT that owns a single payment
 * capture and hangs one child Transaction off each line. An import that grabs
 * the wrong one type-checks for a while, because both modules export names
 * built from the word "order", and then a money surface is reading the wrong
 * row. Check the import path, every time.
 *
 * ⚠️ THE ORDER LEVEL HAS NO MONEY LEVERS AND MUST NOT GROW ANY. A full refund
 * of a consolidated carrier line whose siblings are still HELD throws in
 * AdminService (admin.service.ts ~2233): the siblings have to be unwound
 * first, in an order the operator cannot read off a list row. So an
 * order-level Refund or Release button would be a button whose outcome nobody
 * on this screen can predict. Money stays per line, on the transaction
 * dossier, which is what admin.controller.ts:655 says out loud too. Nothing
 * below POSTs anything — both endpoints here are reads.
 *
 * ⚠️ CENTS IN, CENTS OUT. Every amount is an integer cents column straight off
 * the wire; formatRand in the kit is the only thing that turns one into rands.
 * Formatting inside a data module is how a ledger goes 1c out on a row.
 *
 * 🚨 PRIVACY IS ENFORCED BY OMISSION, NOT BY THE JSX. getOrders selects
 * `buyer: { id, username, email }` and getOrderDossier selects
 * `buyer: { id, username, email, phone }`. Neither `email` nor `phone` is
 * declared on any type below, and `fetchOrderCard` rebuilds its result field
 * by field rather than spreading the response — so a contact detail never
 * reaches React state, a devtools panel or an error report, and a later edit
 * reaching for one is a compile error rather than a leak. Usernames only on a
 * list; identity lives in the People board's member drawer.
 */
import { deskFetch } from './desk-auth';
import { pageWindow, type PageWindow } from './desk-people';
import type { Tone } from './desk-order';

export type { PageWindow };

/** Mirrors prisma OrderStatus. Six values, and the backend takes no other. */
export type OrderStatusKey =
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'PARTIALLY_FULFILLED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED';

/**
 * Mirrors prisma OrderPaymentMethod.
 *
 * ⚠️ NOT THE SAME ENUM AS ANYTHING ON Transaction. There is no shared
 * "PaymentMethod" type in this codebase; a Transaction's shippingMethod,
 * paymentStatus and gateway fields are all different vocabularies. Reusing a
 * type from desk-order.ts here would be wrong values, not just a wrong name.
 * GATEWAY is reserved for the paygate and is unused until Peach goes live.
 */
export type OrderPaymentMethod = 'MANUAL_EFT' | 'GATEWAY';

/** 'ALL' is the absence of a filter, not a seventh status. */
export type OrderSegment = 'ALL' | OrderStatusKey;

/**
 * The chips, in lifecycle order.
 *
 * ⚠️ ONE ENTRY PER REAL ENUM VALUE, NO MERGES AND NO INVENTIONS. getOrders
 * passes `status` straight into a typed Prisma `where`, so unlike getUsers —
 * whose filter if-ladder ends `return {}` and silently matches everyone — a
 * value the enum does not have fails at the database rather than quietly
 * returning the whole table. That is the safer failure, but it is still a
 * failure an operator sees as "Orders is broken", so the union above is the
 * only place a segment key may come from.
 */
export const ORDER_SEGMENTS: { key: OrderSegment; label: string }[] = [
  { key: 'ALL', label: 'All orders' },
  { key: 'AWAITING_PAYMENT', label: 'Awaiting payment' },
  { key: 'PAID', label: 'Paid' },
  { key: 'PARTIALLY_FULFILLED', label: 'Partially fulfilled' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
  { key: 'REFUNDED', label: 'Refunded' },
];

/**
 * One row of GET /admin/orders.
 *
 * ⚠️ NO buyer.email. The server sends it; see the privacy note at the top.
 * `_count.transactions` is the number of lines in the cart — it is NOT the
 * `_count.lineItems` that lib/desk-order.ts's parcelPosition reads, which is a
 * different column on a different select and is not returned here at all.
 */
export interface OrderRow {
  id: string;
  orderReference: string | null;
  status: OrderStatusKey;
  paymentMethod: OrderPaymentMethod;
  /** Integer cents. */
  buyerTotal: number;
  paidAt: string | null;
  createdAt: string;
  buyer: { id: string; username: string | null };
  _count: { transactions: number };
}

export interface OrderBookPage {
  orders: OrderRow[];
  total: number;
  page: number;
  limit: number;
}

/** The wire shape of a list row, declared only so the mapper can pick from it. */
interface OrderRowResponse extends Omit<OrderRow, 'buyer'> {
  buyer: { id: string; username: string | null } | null;
}

interface OrderBookResponse {
  orders: OrderRowResponse[];
  total: number;
  page: number;
  limit: number;
}

/**
 * 20 a page.
 *
 * ⚠️ NOT PEOPLE_PAGE_SIZE. That constant is 50, and it is the default argument
 * of the pageWindow this module borrows — so a caller who forgets to pass a
 * size gets pager arithmetic for a page length this board does not use, and
 * the footer confidently prints "51–100 of 84" over twenty rows. 20 is the
 * backend's own default limit in AdminOrdersController and what the legacy
 * /admin/orders page asked for, so paging matches row-for-row across the
 * cutover.
 */
export const ORDER_PAGE_SIZE = 20;

/**
 * A page of the order book.
 *
 * ⚠️ NO `search` PARAMETER, DELIBERATELY. AdminService.getOrders builds
 * `const where = status ? { status } : {}` and takes nothing else — there is
 * no search branch to send one to. A search box on this board would filter the
 * twenty rows already in the browser while looking exactly like it had
 * searched all 1,204, which is the same class of lie as printing a total over
 * a capped list. If search is wanted, add it to getOrders first.
 *
 * 🚨 THE ROWS ARE REBUILT, NOT PASSED THROUGH. Typing `deskFetch<OrderBookPage>`
 * and returning the body would leave buyer.email on every one of the twenty
 * objects at runtime — invisible to the JSX, and fully present in React state,
 * in a devtools tree and in any error report that serialises it. The type
 * omission stops the JSX; this mapper stops the object. Both are needed.
 */
export async function fetchOrderBook(
  segment: OrderSegment,
  page = 1,
): Promise<OrderBookPage> {
  const params = new URLSearchParams();
  // 'ALL' means "send no status", not "send the string ALL" — that string is
  // not an OrderStatus and Prisma would reject the query.
  if (segment !== 'ALL') params.set('status', segment);
  params.set('page', String(Math.max(1, Math.floor(page))));
  params.set('limit', String(ORDER_PAGE_SIZE));
  const body = await deskFetch<OrderBookResponse>(`/admin/orders?${params.toString()}`);
  return {
    orders: (body.orders ?? []).map((o) => ({
      id: o.id,
      orderReference: o.orderReference,
      status: o.status,
      paymentMethod: o.paymentMethod,
      buyerTotal: o.buyerTotal,
      paidAt: o.paidAt,
      createdAt: o.createdAt,
      // buyer is a required relation on Order, so the null branch is
      // unreachable today — but a handle we cannot read is not a reason to
      // throw away the row's money and status, which is what the operator is
      // scanning for.
      buyer: { id: o.buyer?.id ?? '', username: o.buyer?.username ?? null },
      _count: { transactions: o._count?.transactions ?? 0 },
    })),
    total: body.total,
    page: body.page,
    limit: body.limit,
  };
}

/**
 * The status, toned.
 *
 * ⚠️ REFUNDED IS 'warn', NEVER 'bad', matching paymentTone('REFUNDED') in
 * lib/desk-order.ts. A refund is a completed action someone took on purpose,
 * not a fault. On this board 'bad' would have to mean a dispute, and Order has
 * no status for one — so nothing here is ever drawn in bad-red, and colour
 * keeps meaning what it means everywhere else on the Desk.
 */
export function orderStatusTone(status: OrderStatusKey): Tone {
  switch (status) {
    case 'AWAITING_PAYMENT':
    case 'REFUNDED':
      return 'warn';
    case 'PAID':
    case 'PARTIALLY_FULFILLED':
      return 'info';
    case 'COMPLETED':
      return 'ok';
    case 'CANCELLED':
      return 'neutral';
  }
}

/**
 * Read a segment off a URL — `?status=PAID`.
 *
 * 🚨 THE ONLY DOOR AN UNTRUSTED STATUS MAY COME THROUGH. The board's own chips
 * can only produce the six enum values, but a URL is typed by whoever holds
 * the bookmark, and `status` reaches a typed Prisma `where` — so
 * `?status=paid` (lower case) or `?status=DROP` would fail the query and the
 * operator would read a blank board with a red region as "Orders is broken".
 * Anything unrecognised lands on All, which is the honest wide answer rather
 * than a narrow one nobody asked for. The param name is legacy's, on purpose:
 * a bookmarked /admin/orders?status=PAID survives the cutover redirect.
 */
export function parseOrderSegment(raw: string | null | undefined): OrderSegment {
  if (!raw) return 'ALL';
  return ORDER_SEGMENTS.some((s) => s.key === raw) ? (raw as OrderSegment) : 'ALL';
}

/** Read a 1-based page off a URL. Junk, zero and negatives all mean page 1. */
export function parseOrderPage(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

/** The chip label for a segment, and the prose label for a status. */
export function orderSegmentLabel(key: OrderSegment): string {
  return ORDER_SEGMENTS.find((s) => s.key === key)?.label ?? key;
}

/**
 * DeskShell's sub-line: "1,204 orders" · "312 paid orders".
 *
 * ⚠️ THE TOTAL IS THE SERVER'S, NOT THE LIST'S. This number counts every order
 * matching the filter, while the list under it holds at most twenty — which is
 * exactly why the pager states its window in words rather than letting the
 * header stand in for a list length.
 */
export function orderSub(total: number, key: OrderSegment): string {
  const noun = total === 1 ? 'order' : 'orders';
  if (key === 'ALL') return `${total} ${noun}`;
  return `${total} ${orderSegmentLabel(key).toLowerCase()} ${noun}`;
}

/**
 * "1–20 of 1,204" for THIS board's page length.
 *
 * ⚠️ THE SIZE IS BOUND HERE ON PURPOSE, and pageWindow itself is deliberately
 * NOT re-exported. Its third argument defaults to PEOPLE_PAGE_SIZE (50); a
 * board that imports it and forgets the third argument gets a pager that is
 * silently wrong by a factor of 2.5 and looks entirely plausible. Binding the
 * size in a named function removes the argument a caller can forget.
 */
export function orderPageWindow(total: number, page: number): PageWindow {
  return pageWindow(total, page, ORDER_PAGE_SIZE);
}

/* ────────────────────────────────────────────────────────────────────────
 * The Order card — GET /admin/orders/:id/dossier
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Everything the ORDER row owns that a transaction dossier cannot show: the
 * money split across the whole cart, and the manual-EFT lifecycle stamps.
 *
 * This is what recovers the legacy /admin/orders/[id] page's two best halves,
 * and it costs no extra request: the board has to call this endpoint anyway to
 * learn which line to open the drawer on.
 *
 * ⚠️ RENDERED, NEVER DERIVED. The four parts and the total are five stored
 * columns whose invariant is the backend's; the drawer prints all five and
 * adds nothing up. The platform has one fee presenter and this is not it.
 */
export interface OrderCard {
  id: string;
  orderReference: string | null;
  status: OrderStatusKey;
  paymentMethod: OrderPaymentMethod;
  /** Integer cents, all five. */
  itemsSubtotal: number;
  shippingSubtotal: number;
  handlingSubtotal: number;
  processingFee: number;
  buyerTotal: number;
  /** Manual-EFT only; all three are null on a gateway order. */
  manualPayByAt: string | null;
  manualDetectedAt: string | null;
  manualCancelledAt: string | null;
  paidAt: string | null;
  createdAt: string;
  lineCount: number;
  /**
   * The line a board opens the Order drawer on. Null when the order has no
   * transactions at all — which is a real shape (an AWAITING_PAYMENT order
   * whose lines were cancelled), and is why the caller must branch on it
   * rather than reaching for `[0].id`.
   */
  firstTransactionId: string | null;
}

/** The wire shape, declared only so the mapper below can pick from it. */
interface OrderDossierResponse {
  order: {
    id: string;
    orderReference: string | null;
    status: OrderStatusKey;
    paymentMethod: OrderPaymentMethod;
    itemsSubtotal: number;
    shippingSubtotal: number;
    handlingSubtotal: number;
    processingFee: number;
    buyerTotal: number;
    manualPayByAt: string | null;
    manualDetectedAt: string | null;
    manualCancelledAt: string | null;
    paidAt: string | null;
    createdAt: string;
    transactions: { id: string }[];
  };
}

/**
 * Read one order's card.
 *
 * 🚨 THIS FUNCTION IS THE MEMBRANE. The response carries buyer.email and
 * buyer.phone, plus a per-line seller username, sellerPayout and
 * refundedAmount this surface has no place for. Building the card field by
 * field — never `{ ...order }` — is what keeps every one of them out of React
 * state. Do not "simplify" this into a spread.
 */
export async function fetchOrderCard(orderId: string): Promise<OrderCard> {
  const { order } = await deskFetch<OrderDossierResponse>(
    `/admin/orders/${encodeURIComponent(orderId)}/dossier`,
  );
  const lines = order.transactions ?? [];
  return {
    id: order.id,
    orderReference: order.orderReference,
    status: order.status,
    paymentMethod: order.paymentMethod,
    itemsSubtotal: order.itemsSubtotal,
    shippingSubtotal: order.shippingSubtotal,
    handlingSubtotal: order.handlingSubtotal,
    processingFee: order.processingFee,
    buyerTotal: order.buyerTotal,
    manualPayByAt: order.manualPayByAt,
    manualDetectedAt: order.manualDetectedAt,
    manualCancelledAt: order.manualCancelledAt,
    paidAt: order.paidAt,
    createdAt: order.createdAt,
    lineCount: lines.length,
    firstTransactionId: lines[0]?.id ?? null,
  };
}

/**
 * What to print in the Reference column.
 *
 * ⚠️ THE ELLIPSIS IS THE POINT. orderReference is nullable, and the legacy
 * page fell back to `id.slice(0, 8)` bare — eight characters of a cuid that
 * look exactly like an order number and get pasted into a search that only
 * knows GG-ORD numbers. The trailing character says "this is a fragment of an
 * id", which is the same honesty orderReferenceOf() applies in the drawer.
 */
export function orderRowReference(row: Pick<OrderRow, 'id' | 'orderReference'>): string {
  return row.orderReference ?? `${row.id.slice(0, 8)}…`;
}
