/**
 * GET /stripe/customers?q=searchQuery
 *
 * Searches Stripe customers by name or email.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../shared/auth';
import { success, badRequest, serverError } from '../shared/response';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
const STRIPE_BASE = 'https://api.stripe.com/v1';

async function stripeGet(path: string): Promise<unknown> {
  const res = await fetch(`${STRIPE_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe API error (${res.status}): ${text}`);
  }
  return res.json();
}

interface StripePaymentMethod {
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
}

interface StripeCustomerRaw {
  id: string;
  name: string | null;
  email: string | null;
  invoice_settings?: {
    default_payment_method?: string | null;
  };
}

interface StripeSearchResponse {
  data: StripeCustomerRaw[];
}

async function getDefaultPaymentMethod(pmId: string) {
  try {
    const pm = (await stripeGet(`/payment_methods/${pmId}`)) as StripePaymentMethod;
    if (pm.card) {
      return {
        brand: pm.card.brand,
        last4: pm.card.last4,
        expMonth: pm.card.exp_month,
        expYear: pm.card.exp_year,
      };
    }
  } catch {
    // ignore — just won't show card info
  }
  return undefined;
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);
    const query = event.queryStringParameters?.q;
    if (!query || query.trim().length < 2) {
      return badRequest('Search query must be at least 2 characters');
    }

    const q = query.trim();

    // Use Stripe Search API — search by name or email
    const searchQuery = `name~'${q}' OR email~'${q}'`;
    const params = new URLSearchParams({
      query: searchQuery,
      limit: '10',
    });

    const result = (await stripeGet(`/customers/search?${params}`)) as StripeSearchResponse;

    // Map to frontend shape, resolve default payment methods
    const customers = await Promise.all(
      result.data.map(async (c) => {
        const pmId = c.invoice_settings?.default_payment_method;
        const defaultPaymentMethod = pmId ? await getDefaultPaymentMethod(pmId) : undefined;

        return {
          id: c.id,
          name: c.name || '',
          email: c.email || '',
          defaultPaymentMethod,
        };
      }),
    );

    return success({ customers });
  } catch (err) {
    console.error('Stripe customer search error:', err);
    return serverError('Failed to search customers');
  }
};
