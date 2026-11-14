import { test } from "node:test";
import assert from "node:assert/strict";
import { priceIdForPlan } from "../stripe.ts";

test("priceIdForPlan returns the configured price id", () => {
  process.env.STRIPE_PRICE_PRO = "price_123";
  assert.equal(priceIdForPlan("pro"), "price_123");
  delete process.env.STRIPE_PRICE_PRO;
});

test("priceIdForPlan rejects a product id with an actionable message", () => {
  process.env.STRIPE_PRICE_ULTRA = "prod_123";
  assert.throws(() => priceIdForPlan("ultra"), /Product ID/);
  delete process.env.STRIPE_PRICE_ULTRA;
});

test("priceIdForPlan rejects values that are not price ids", () => {
  process.env.STRIPE_PRICE_BOMB = "75";
  assert.throws(() => priceIdForPlan("bomb"), /Price ID/);
  delete process.env.STRIPE_PRICE_BOMB;
});

test("priceIdForPlan fails when the variable is missing", () => {
  delete process.env.STRIPE_PRICE_PRO;
  assert.throws(() => priceIdForPlan("pro"), /is not set/);
});
