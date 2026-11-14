import type Stripe from "stripe";

// Stripe moved the price reference around between API versions: newer ones
// expose it as `line.pricing.price_details.price`, older ones as `line.price`.
type InvoiceLinePriceFields = {
  price?: string | Stripe.Price | null;
  pricing?: { price_details?: { price?: string | Stripe.Price | null } | null } | null;
};

// Invoices carry our metadata in different places depending on the API version.
type InvoiceMetadataFields = {
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  parent?: { subscription_details?: { metadata?: Record<string, string> | null } | null } | null;
};

type PeriodEndFields = { current_period_end?: number };

export function priceIdOf(
  price: string | Stripe.Price | null | undefined,
): string | null {
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

export function priceIdFromInvoiceLine(
  line: Stripe.InvoiceLineItem | undefined,
): string | null {
  if (!line) return null;
  const fields = line as unknown as InvoiceLinePriceFields;
  return priceIdOf(fields.pricing?.price_details?.price ?? fields.price);
}

// userId is stamped onto the subscription metadata at checkout, so it can be
// resolved from the invoice even when the local customer row has not been
// written yet (event ordering is not guaranteed).
export function userIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const fields = invoice as unknown as InvoiceMetadataFields;
  return (
    fields.parent?.subscription_details?.metadata?.userId ??
    fields.subscription_details?.metadata?.userId ??
    null
  );
}

// `current_period_end` lives on the subscription in older API versions and on
// the subscription items in newer ones.
export function subscriptionPeriodEnd(
  sub: Stripe.Subscription,
): Date | undefined {
  const legacy = (sub as unknown as PeriodEndFields).current_period_end;
  const fromItem = (sub.items?.data?.[0] as unknown as PeriodEndFields | undefined)
    ?.current_period_end;
  const seconds = legacy ?? fromItem;
  return seconds ? new Date(seconds * 1000) : undefined;
}

// Ledger rows use the Stripe object id as primary key, so a retried event hits
// a unique violation (Postgres 23505) instead of granting tokens twice.
export function isDuplicateLedgerEntry(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function ledgerIdForTopup(sessionId: string): string {
  return `stripe:topup:${sessionId}`;
}

export function ledgerIdForInvoice(invoiceId: string): string {
  return `stripe:invoice:${invoiceId}`;
}

export function ledgerIdForEvent(prefix: string, eventId: string): string {
  return `stripe:${prefix}:${eventId}`;
}
