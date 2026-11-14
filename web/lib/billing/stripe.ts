import Stripe from "stripe";

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  return (globalForStripe.stripe ??= new Stripe(key));
}

// Map a Stripe Price ID back to our internal plan id using env config.
export function planIdFromPriceId(priceId: string | null | undefined) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ULTRA) return "ultra";
  if (priceId === process.env.STRIPE_PRICE_BOMB) return "bomb";
  return null;
}

export function priceIdForPlan(planId: string) {
  const key = `STRIPE_PRICE_${planId.toUpperCase()}`;
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set. Create the Stripe Price and add it to .env.`);
  }
  if (!value.startsWith("price_")) {
    const hint = value.startsWith("prod_")
      ? "That is a Product ID — use the Price ID (price_…) of that product."
      : "Use the Stripe Price ID (price_…).";
    throw new Error(`${key} must be a Stripe Price ID. ${hint}`);
  }
  return value;
}
