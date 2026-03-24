/**
 * GET /billing/lookup?q={emailOrPhone}
 *
 * Searches Stripe (and DynamoDB fallback) for a patient by email or phone.
 * Returns customer info and saved payment method.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { getCallerIdentity } from '../../shared/auth';
import { queryItems } from '../../shared/dynamo';
import { success, badRequest, notFound, serverError } from '../../shared/response';
import { stripeGet } from '../../shared/stripe';

interface StripeCustomer {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  metadata?: Record<string, string>;
}

interface StripeSearchResponse {
  data: StripeCustomer[];
}

interface StripePaymentMethod {
  id: string;
  card?: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
}

interface StripePaymentMethodList {
  data: StripePaymentMethod[];
}

function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function splitName(name?: string): { firstName: string; lastName: string } {
  if (!name) return { firstName: '', lastName: '' };
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
  };
}

export const handler: APIGatewayProxyHandler = async (event) => {
  try {
    getCallerIdentity(event);

    const q = (event.queryStringParameters?.q || '').trim();
    if (!q) return badRequest('Query parameter q is required');

    let customer: StripeCustomer | null = null;
    const isEmail = q.includes('@');

    // 1. Search Stripe by email
    if (isEmail) {
      const email = q.toLowerCase();
      const res = await stripeGet<StripeSearchResponse>(
        `/customers?email=${encodeURIComponent(email)}&limit=1`,
      );
      if (res.ok && res.data.data?.length > 0) {
        customer = res.data.data[0];
      }
    }

    // 2. Search Stripe by phone
    if (!customer) {
      const phone = normalizePhone(q);
      if (phone.length >= 10) {
        const res = await stripeGet<StripeSearchResponse>(
          `/customers/search?query=phone%3A%27%2B1${phone}%27&limit=1`,
        );
        if (res.ok && res.data.data?.length > 0) {
          customer = res.data.data[0];
        }
        // Also try without +1 prefix
        if (!customer) {
          const res2 = await stripeGet<StripeSearchResponse>(
            `/customers/search?query=phone%3A%27${phone}%27&limit=1`,
          );
          if (res2.ok && res2.data.data?.length > 0) {
            customer = res2.data.data[0];
          }
        }
      }
    }

    // 3. DynamoDB fallback — scan patients by email or phone
    if (!customer) {
      try {
        const filterParts: string[] = [];
        const exprValues: Record<string, string> = {};

        if (isEmail) {
          filterParts.push('email = :email');
          exprValues[':email'] = q.toLowerCase();
        } else {
          const phone = normalizePhone(q);
          if (phone.length >= 10) {
            filterParts.push('contains(phone, :phone)');
            exprValues[':phone'] = phone;
          }
        }

        if (filterParts.length > 0) {
          const patients = await queryItems({
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :pk',
            FilterExpression: filterParts.join(' OR '),
            ExpressionAttributeValues: {
              ':pk': 'PATIENT',
              ...exprValues,
            },
            Limit: 1,
          });

          if (patients.length > 0) {
            const p = patients[0];
            return success({
              customerId: null,
              firstName: p.firstName as string || '',
              lastName: p.lastName as string || '',
              email: (p.email as string) || '',
              phone: (p.phone as string) || '',
              paymentMethod: null,
              source: 'dynamo',
            });
          }
        }
      } catch (err) {
        console.warn('DynamoDB patient lookup failed (non-fatal):', (err as Error).message);
      }
    }

    if (!customer) {
      return notFound('No patient found.');
    }

    // 4. Get payment methods
    let paymentMethod: {
      id: string;
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    } | null = null;

    const pmRes = await stripeGet<StripePaymentMethodList>(
      `/payment_methods?customer=${customer.id}&type=card&limit=1`,
    );
    if (pmRes.ok && pmRes.data.data?.length > 0) {
      const pm = pmRes.data.data[0];
      if (pm.card) {
        paymentMethod = {
          id: pm.id,
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
        };
      }
    }

    const { firstName, lastName } = splitName(customer.name);

    return success({
      customerId: customer.id,
      firstName: customer.metadata?.firstName || firstName,
      lastName: customer.metadata?.lastName || lastName,
      email: customer.email || '',
      phone: customer.phone || '',
      paymentMethod,
    });
  } catch (err) {
    console.error('Billing lookup error:', (err as Error).message);
    return serverError('Failed to look up patient');
  }
};
