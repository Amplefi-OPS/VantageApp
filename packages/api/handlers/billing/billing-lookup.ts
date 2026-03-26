/**
 * GET /billing/lookup?q={emailOrPhone}
 *
 * Searches Stripe (and DynamoDB fallback) for a patient by email or phone.
 * Returns customer info and saved payment method.
 */

import type { APIGatewayProxyHandler } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getCallerIdentity } from '../../shared/auth';
import { queryItems } from '../../shared/dynamo';
import { success, badRequest, notFound, serverError } from '../../shared/response';
import { stripeGet } from '../../shared/stripe';

const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const LEADS_TABLE = process.env.LEADS_TABLE || 'vantage-patient-leads';

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
    const isPhone = /^\+?\d[\d\s\-().]{6,}$/.test(q);
    const isName = !isEmail && !isPhone;

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
    if (!customer && isPhone) {
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

    // 3. Search Stripe by name
    if (!customer && isName) {
      const res = await stripeGet<StripeSearchResponse>(
        `/customers/search?query=name%3A%27${encodeURIComponent(q)}%27&limit=1`,
      );
      if (res.ok && res.data.data?.length > 0) {
        customer = res.data.data[0];
      }
    }

    // 3. DynamoDB fallback — check vantage-patient-leads (VR Landing bookings) first
    if (!customer) {
      try {
        const phone = normalizePhone(q);
        const filterExpr = isEmail
          ? 'email = :q'
          : 'contains(#ph, :q)';
        const exprAttrNames = isEmail ? undefined : { '#ph': 'phone' };
        const exprValues: Record<string, string> = { ':q': isEmail ? q.toLowerCase() : phone };

        if (!isEmail && phone.length < 10) {
          // Not enough digits, skip
        } else {
          const leadsResult = await ddbClient.send(new ScanCommand({
            TableName: LEADS_TABLE,
            FilterExpression: filterExpr,
            ExpressionAttributeNames: exprAttrNames,
            ExpressionAttributeValues: exprValues,
            Limit: 10,
          }));

          if (leadsResult.Items && leadsResult.Items.length > 0) {
            const lead = leadsResult.Items[0];
            // If they have a Stripe customerId stored in the leads table, fetch their card
            if (lead.customerId) {
              const pmRes = await stripeGet<StripePaymentMethodList>(
                `/payment_methods?customer=${lead.customerId}&type=card&limit=1`,
              );
              const pm = pmRes.ok && pmRes.data.data?.length > 0 ? pmRes.data.data[0] : null;
              return success({
                customerId: lead.customerId as string,
                firstName: (lead.firstName as string) || '',
                lastName: (lead.lastName as string) || '',
                email: (lead.email as string) || '',
                phone: (lead.phone as string) || '',
                paymentMethod: pm?.card ? {
                  id: pm.id,
                  brand: pm.card.brand,
                  last4: pm.card.last4,
                  expMonth: pm.card.exp_month,
                  expYear: pm.card.exp_year,
                } : null,
              });
            }
            // No Stripe ID, return name/contact only
            return success({
              customerId: null,
              firstName: (lead.firstName as string) || '',
              lastName: (lead.lastName as string) || '',
              email: (lead.email as string) || '',
              phone: (lead.phone as string) || '',
              paymentMethod: null,
            });
          }
        }
      } catch (err) {
        console.warn('Leads table lookup failed (non-fatal):', (err as Error).message);
      }
    }

    // 4. DynamoDB fallback — scan Vantage main table patients by email, phone, or name
    if (!customer) {
      try {
        const patients = await queryItems({
          IndexName: 'GSI2',
          KeyConditionExpression: 'GSI2PK = :pk',
          ExpressionAttributeValues: {
            ':pk': 'PATIENT',
          },
        });

        let match: Record<string, unknown> | undefined;
        if (isEmail) {
          match = patients.find((p) => (p.email as string || '').toLowerCase() === q.toLowerCase());
        } else if (isPhone) {
          const phone = normalizePhone(q);
          match = patients.find((p) => normalizePhone((p.phone as string) || '') === phone);
        } else {
          // Name search: match first name, last name, or full name (case-insensitive)
          const qLower = q.toLowerCase();
          match = patients.find((p) => {
            const first = ((p.firstName as string) || '').toLowerCase();
            const last = ((p.lastName as string) || '').toLowerCase();
            const full = `${first} ${last}`;
            return first.includes(qLower) || last.includes(qLower) || full.includes(qLower);
          });
        }

        if (match) {
          return success({
            customerId: null,
            firstName: (match.firstName as string) || '',
            lastName: (match.lastName as string) || '',
            email: (match.email as string) || '',
            phone: (match.phone as string) || '',
            paymentMethod: null,
          });
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
