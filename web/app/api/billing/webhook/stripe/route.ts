import { NextResponse } from "next/server";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { subscriptions, type PlanId } from "@/lib/db/schema";
import { getStripe, planIdFromPriceId, priceIdForPlan } from "@/lib/billing/stripe";
import { activatePlan, grantPrepaidTokens } from "@/lib/billing/service";
import { paygTokensForEur } from "@/lib/billing/plans";
import {
  isDuplicateLedgerEntry,
  ledgerIdForEvent,
  ledgerIdForInvoice,
  ledgerIdForTopup,
  priceIdFromInvoiceLine,
  priceIdOf,
  subscriptionPeriodEnd,
  userIdFromInvoice,
} from "@/lib/billing/webhook-helpers";

async function userIdByCustomerId(customerId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .limit(1);
  return row?.userId ?? null;
}

// Grants pay-as-you-go tokens for a completed Checkout Session. Delayed payment
// methods fire `checkout.session.completed` before the money has settled, so the
// payment status decides — not the event type.
async function grantTopupFromSession(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId;
  if (!userId || session.metadata?.kind !== "topup") return;
  if (session.payment_status !== "paid") return;

  const tokens =
    Number(session.metadata.tokens) ||
    paygTokensForEur(Number(session.metadata.amountEur) || 0);
  if (tokens <= 0) return;

  await grantPrepaidTokens(
    userId,
    tokens,
    { provider: "stripe", sessionId: session.id },
    { ledgerId: ledgerIdForTopup(session.id) },
  );
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = (await headers()).get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not set." },
      { status: 500 },
    );
  }

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature ?? "", webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      // One-time pay-as-you-go top-up, plus the deferred settlement of the same
      // session for asynchronous payment methods.
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        await grantTopupFromSession(event.data.object as Stripe.Checkout.Session);
        break;
      }

      // Record Stripe IDs when the subscription object is first created.
      case "customer.subscription.created": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        if (!userId) break;
        await db
          .update(subscriptions)
          .set({
            stripeCustomerId: String(sub.customer),
            stripeSubscriptionId: sub.id,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
        break;
      }

      // Payment succeeded: (re)activate a plan for the period Stripe charged.
      // Covers first purchase (subscription_create) and renewals (subscription_cycle).
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (
          invoice.billing_reason !== "subscription_create" &&
          invoice.billing_reason !== "subscription_cycle"
        ) {
          break;
        }
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        // Metadata on the invoice resolves the user even when the customer row
        // has not been written yet — event order is not guaranteed.
        const userId =
          userIdFromInvoice(invoice) ??
          (customerId ? await userIdByCustomerId(customerId) : null);
        if (!userId) break;
        const planId = planIdFromPriceId(priceIdFromInvoiceLine(invoice.lines.data[0]));
        if (!planId) break;
        await activatePlan(userId, planId, {
          periodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : undefined,
          ledgerId: ledgerIdForInvoice(invoice.id),
        });
        break;
      }

      // Plan change (upgrade) or status change. Only an actual plan change may
      // reset the token allowance: cancelling, scheduling a downgrade or editing
      // a card all emit this event and must keep the current usage.
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";
        const userId =
          sub.metadata?.userId ?? (customerId ? await userIdByCustomerId(customerId) : null);
        if (!userId) break;

        if (sub.status === "past_due" || sub.status === "unpaid") {
          await db
            .update(subscriptions)
            .set({
              status: "past_due",
              cancelAtPeriodEnd: sub.cancel_at_period_end,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.userId, userId));
          break;
        }

        const planId = planIdFromPriceId(priceIdOf(sub.items.data[0]?.price));
        const [row] = await db
          .select({ plan: subscriptions.plan })
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId))
          .limit(1);

        if (
          planId &&
          (sub.status === "active" || sub.status === "trialing") &&
          row?.plan !== planId
        ) {
          await activatePlan(userId, planId, {
            periodEnd: subscriptionPeriodEnd(sub),
            ledgerId: ledgerIdForEvent("sub-update", event.id),
          });
          break;
        }

        await db
          .update(subscriptions)
          .set({
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            stripeSubscriptionId: sub.id,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.userId, userId));
        break;
      }

      // Period ended: apply pending downgrade (re-subscribe) or fall back to free.
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? "";
        const userId =
          sub.metadata?.userId ?? (customerId ? await userIdByCustomerId(customerId) : null);
        if (!userId) break;

        const [row] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.userId, userId))
          .limit(1);
        const pending = row?.pendingPlanId as PlanId | null | undefined;

        if (pending && pending !== "free") {
          try {
            const renewed = await stripe.subscriptions.create({
              customer: String(sub.customer),
              items: [{ price: priceIdForPlan(pending) }],
              metadata: { userId, planId: pending },
            });
            if (renewed.status === "active" || renewed.status === "trialing") {
              await activatePlan(userId, pending, {
                periodEnd: subscriptionPeriodEnd(renewed),
                ledgerId: ledgerIdForEvent("sub-renew", event.id),
              });
            }
          } catch {
            await activatePlan(userId, "free");
          }
        } else {
          await activatePlan(userId, "free");
        }

        await db
          .update(subscriptions)
          .set({ pendingPlanId: null, cancelAtPeriodEnd: false, updatedAt: new Date() })
          .where(eq(subscriptions.userId, userId));
        break;
      }
    }
  } catch (err) {
    // A retried delivery of an event we already applied hits the ledger primary
    // key. That is success from Stripe's point of view, not a failure.
    if (isDuplicateLedgerEntry(err)) {
      return NextResponse.json({ received: true });
    }
    console.error("Stripe webhook handler failed:", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
