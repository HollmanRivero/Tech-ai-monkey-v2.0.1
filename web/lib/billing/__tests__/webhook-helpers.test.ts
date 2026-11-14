import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import {
  isDuplicateLedgerEntry,
  ledgerIdForEvent,
  ledgerIdForInvoice,
  ledgerIdForTopup,
  priceIdFromInvoiceLine,
  priceIdOf,
  subscriptionPeriodEnd,
  userIdFromInvoice,
} from "../webhook-helpers.ts";

test("priceIdOf handles ids, expanded prices and missing values", () => {
  assert.equal(priceIdOf("price_123"), "price_123");
  assert.equal(priceIdOf({ id: "price_456" } as Stripe.Price), "price_456");
  assert.equal(priceIdOf(null), null);
  assert.equal(priceIdOf(undefined), null);
});

test("priceIdFromInvoiceLine prefers the new pricing shape", () => {
  const line = {
    pricing: { price_details: { price: "price_new" } },
    price: { id: "price_old" },
  } as unknown as Stripe.InvoiceLineItem;
  assert.equal(priceIdFromInvoiceLine(line), "price_new");
});

test("priceIdFromInvoiceLine falls back to the legacy price field", () => {
  const line = { price: "price_legacy" } as unknown as Stripe.InvoiceLineItem;
  assert.equal(priceIdFromInvoiceLine(line), "price_legacy");

  const expanded = { price: { id: "price_expanded" } } as unknown as Stripe.InvoiceLineItem;
  assert.equal(priceIdFromInvoiceLine(expanded), "price_expanded");
});

test("priceIdFromInvoiceLine gives up gracefully", () => {
  assert.equal(priceIdFromInvoiceLine(undefined), null);
  assert.equal(priceIdFromInvoiceLine({} as Stripe.InvoiceLineItem), null);
});

test("userIdFromInvoice reads the parent (new API) metadata", () => {
  const invoice = {
    parent: { subscription_details: { metadata: { userId: "user_new" } } },
  } as unknown as Stripe.Invoice;
  assert.equal(userIdFromInvoice(invoice), "user_new");
});

test("userIdFromInvoice falls back to subscription_details (old API)", () => {
  const invoice = {
    subscription_details: { metadata: { userId: "user_old" } },
  } as unknown as Stripe.Invoice;
  assert.equal(userIdFromInvoice(invoice), "user_old");
});

test("userIdFromInvoice returns null when metadata is absent", () => {
  assert.equal(userIdFromInvoice({} as Stripe.Invoice), null);
  assert.equal(
    userIdFromInvoice({
      parent: { subscription_details: { metadata: {} } },
    } as unknown as Stripe.Invoice),
    null,
  );
});

test("subscriptionPeriodEnd supports both API shapes", () => {
  const legacy = {
    current_period_end: 1_700_000_000,
    items: { data: [] },
  } as unknown as Stripe.Subscription;
  assert.equal(subscriptionPeriodEnd(legacy)?.getTime(), 1_700_000_000_000);

  const modern = {
    items: { data: [{ current_period_end: 1_800_000_000 }] },
  } as unknown as Stripe.Subscription;
  assert.equal(subscriptionPeriodEnd(modern)?.getTime(), 1_800_000_000_000);

  assert.equal(
    subscriptionPeriodEnd({ items: { data: [] } } as unknown as Stripe.Subscription),
    undefined,
  );
});

test("isDuplicateLedgerEntry detects unique violations, also when wrapped", () => {
  const direct = Object.assign(new Error("duplicate key"), { code: "23505" });
  assert.equal(isDuplicateLedgerEntry(direct), true);

  const wrapped = new Error("query failed");
  (wrapped as { cause?: unknown }).cause = direct;
  assert.equal(isDuplicateLedgerEntry(wrapped), true);

  assert.equal(isDuplicateLedgerEntry(new Error("boom")), false);
  assert.equal(isDuplicateLedgerEntry(Object.assign(new Error(), { code: "23503" })), false);
  assert.equal(isDuplicateLedgerEntry(null), false);
  assert.equal(isDuplicateLedgerEntry("23505"), false);

  const loop = new Error("self");
  (loop as { cause?: unknown }).cause = loop;
  assert.equal(isDuplicateLedgerEntry(loop), false);
});

test("ledger ids are stable and namespaced per Stripe object", () => {
  assert.equal(ledgerIdForTopup("cs_test_1"), "stripe:topup:cs_test_1");
  assert.equal(ledgerIdForInvoice("in_1"), "stripe:invoice:in_1");
  assert.equal(ledgerIdForEvent("sub-update", "evt_1"), "stripe:sub-update:evt_1");
  assert.notEqual(ledgerIdForTopup("cs_1"), ledgerIdForTopup("cs_2"));
});
