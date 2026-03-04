/**
 * GET /stripe/transactions
 *
 * Lists recent PaymentIntents from Stripe for the billing dashboard.
 *
 * Returns:
 * {
 *   "transactions": [...],
 *   "hasMore": false,
 *   "totalCount": 25
 * }
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { success, serverError } from '../shared/response';
import { getSecrets } from '../shared/secrets';

const STRIPE_BASE = 'https://api.stripe.com/v1';

async function stripeGet(path: string): Promise<unknown> {
  const { STRIPE_SECRET_KEY } = await getSecrets();
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe API error (${res.status}): ${text}`);
  }
  return res.json();
}

interface StripeCharge {
  id: string;
  amount: number;
  status: string;
}

interface StripePaymentIntent {
  id: string;
  amount: number;
  status: string;
  description: string | null;
  customer: string | null;
  created: number;
  metadata: Record<string, string>;
  latest_charge: string | StripeCharge | null;
}

interface StripeCustomerRaw {
  id: string;
  name: string | null;
  email: string | null;
}

interface StripeListResponse {
  data: StripePaymentIntent[];
  has_more: boolean;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);

    // Fetch recent payment intents (last 100)
    const params = new URLSearchParams({ limit: '100' });
    const result = (await stripeGet(`/payment_intents?${params}`)) as StripeListResponse;

    // Collect unique customer IDs to batch-resolve names
    const customerIds = new Set<string>();
    for (const pi of result.data) {
      if (pi.customer) customerIds.add(pi.customer as string);
    }

    // Resolve customer names (parallel)
    const customerMap = new Map<string, { name: string | null; email: string | null }>();
    await Promise.all(
      [...customerIds].map(async (id) => {
        try {
          const c = (await stripeGet(`/customers/${id}`)) as StripeCustomerRaw;
          customerMap.set(id, { name: c.name, email: c.email });
        } catch {
          customerMap.set(id, { name: null, email: null });
        }
      }),
    );

    const transactions = result.data.map((pi) => {
      const cust = pi.customer ? customerMap.get(pi.customer as string) : null;
      return {
        id: pi.id,
        amount: pi.amount,
        status: pi.status,
        description: pi.description,
        customerName: cust?.name || null,
        customerEmail: cust?.email || null,
        created: pi.created,
        metadata: pi.metadata || {},
      };
    });

    return success({
      transactions,
      hasMore: result.has_more,
      totalCount: transactions.length,
    });
  } catch (err) {
    console.error('Stripe transactions error:', (err as Error).message);
    return serverError('Failed to list transactions');
  }
};
