import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { subscriptions, type PlanId } from "@/lib/db/schema";
import { getStripe, priceIdForPlan } from "@/lib/billing/stripe";
import {
  PLANS,
  PLAN_RANK,
  PAID_PLANS,
  isValidPaygAmount,
  paygTokensForEur,
} from "@/lib/billing/plans";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
  const stripe = getStripe();
  const userId = session.user.id;
  const email = session.user.email ?? undefined;

  // ---- Subscription plan (PRO / Ultra / Bomb) ----
  if (body.kind === "plan") {
    const planId = body.planId as PlanId;
    if (!PAID_PLANS.includes(planId)) {
      return NextResponse.json({ error: "Unknown plan." }, { status: 400 });
    }

    // An existing subscriber must change the subscription they already have —
    // a second Checkout Session would create a second subscription and bill
    // the customer twice.
    const [existing] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    if (existing?.stripeSubscriptionId) {
      let current: Stripe.Subscription | null = null;
      try {
        current = await stripe.subscriptions.retrieve(existing.stripeSubscriptionId);
      } catch {
        current = null;
      }

      if (current && current.status !== "canceled" && current.status !== "incomplete_expired") {
        if (PLAN_RANK.indexOf(planId) <= PLAN_RANK.indexOf(existing.plan)) {
          return NextResponse.json(
            {
              error: `You are already on ${PLANS[existing.plan].name}. Use the downgrade button to switch down at the end of the period.`,
            },
            { status: 409 },
          );
        }

        const item = current.items.data[0];
        if (!item) {
          return NextResponse.json(
            { error: "Stripe subscription has no items." },
            { status: 409 },
          );
        }

        try {
          await stripe.subscriptions.update(existing.stripeSubscriptionId, {
            items: [{ id: item.id, price: priceIdForPlan(planId) }],
            proration_behavior: "always_invoice",
            payment_behavior: "error_if_incomplete",
            metadata: { userId, planId },
          });
        } catch (err) {
          console.error("Stripe upgrade failed:", err);
          return NextResponse.json(
            { error: "Stripe could not complete the upgrade (the payment failed)." },
            { status: 402 },
          );
        }

        // The customer.subscription.updated webhook grants the new allowance;
        // the redirect shows the new plan once it has been applied.
        return NextResponse.json({ url: `${baseUrl}/dashboard?checkout=success` });
      }

      // The stored subscription is gone on Stripe's side: drop the stale id so
      // a fresh Checkout Session can be created below.
      await db
        .update(subscriptions)
        .set({ stripeSubscriptionId: null, updatedAt: new Date() })
        .where(eq(subscriptions.userId, userId));
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceIdForPlan(planId), quantity: 1 }],
      customer_email: email,
      metadata: { userId, kind: "plan", planId },
      subscription_data: { metadata: { userId, planId } },
      success_url: `${baseUrl}/dashboard?checkout=success`,
      cancel_url: `${baseUrl}/pricing?checkout=cancel`,
    });
    return NextResponse.json({ url: checkout.url });
  }

  // ---- Pay-as-you-go top-up (one-time payment) ----
  if (body.kind === "topup") {
    const amountEur = Number(body.amountEur);
    if (!isValidPaygAmount(amountEur)) {
      return NextResponse.json(
        { error: "Amount must be between €5 and €100." },
        { status: 400 },
      );
    }
    const tokens = paygTokensForEur(amountEur);
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: Math.round(amountEur * 100),
            product_data: {
              name: `Tech AI monkey — ${tokens.toLocaleString()} tokens`,
            },
          },
        },
      ],
      customer_email: email,
      metadata: {
        userId,
        kind: "topup",
        amountEur: String(amountEur),
        tokens: String(tokens),
      },
      success_url: `${baseUrl}/dashboard?checkout=success`,
      cancel_url: `${baseUrl}/pricing?checkout=cancel`,
    });
    return NextResponse.json({ url: checkout.url });
  }

  return NextResponse.json({ error: "Unknown kind." }, { status: 400 });
}
