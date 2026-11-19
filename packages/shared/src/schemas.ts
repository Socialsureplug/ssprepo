import { z } from 'zod';
import { WEBHOOK_EVENT_TYPES, MERCHANT_ROLES, SETTLEMENT_SCHEDULES } from './statuses';

/** Shared request validation schemas, used by the API and by forms in the web apps. */

const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const signupSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.email().max(254).transform((e) => e.toLowerCase()),
  password,
  businessName: z.string().trim().min(2).max(160),
});

export const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const forgotPasswordSchema = z.object({ email: z.email().transform((e) => e.toLowerCase()) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });
export const verifyEmailSchema = z.object({ token: z.string().min(20).max(200) });

export const nigerianPhone = z
  .string()
  .trim()
  .regex(/^(\+?234|0)[789][01]\d{8}$/, 'Enter a valid Nigerian phone number');

export const accountNumber = z.string().regex(/^\d{10}$/, 'Account number must be 10 digits');

export const businessProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(160),
  businessType: z.enum(['sole_proprietorship', 'partnership', 'limited_liability', 'ngo', 'other']),
  businessEmail: z.email(),
  businessPhone: nigerianPhone,
  country: z.literal('NG'),
  registrationNumber: z.string().trim().min(2).max(40),
  taxId: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().min(5).max(300),
  description: z.string().trim().min(10).max(1000),
  website: z.url().optional().or(z.literal('')),
  expectedMonthlyVolume: z.enum(['lt_1m', '1m_10m', '10m_50m', '50m_200m', 'gt_200m']),
  directorName: z.string().trim().min(2).max(160),
  directorEmail: z.email(),
  directorPhone: nigerianPhone,
  directorBvnLast4: z.string().regex(/^\d{4}$/, 'Last 4 digits only').optional().or(z.literal('')),
});

export const bankAccountSchema = z.object({
  bankCode: z.string().regex(/^\d{3,6}$/),
  accountNumber,
});

export const createPaymentSchema = z.object({
  amount: z.number().int('Amount must be in kobo (integer)').min(10_000, 'Minimum amount is ₦100').max(1_000_000_000_00),
  currency: z.literal('NGN').default('NGN'),
  email: z.email(),
  name: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(20).optional(),
  reference: z.string().trim().regex(/^[A-Za-z0-9._\-]{3,64}$/, 'Reference may contain letters, digits, . _ -').optional(),
  description: z.string().trim().max(500).optional(),
  expiresInMinutes: z.number().int().min(10).max(60 * 24).default(30),
  callbackUrl: z.url().optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const paymentLinkSchema = z.object({
  title: z.string().trim().min(2).max(120),
  amount: z.number().int().min(10_000).max(1_000_000_000_00).nullable(),
  currency: z.literal('NGN').default('NGN'),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  customerEmail: z.email().optional().or(z.literal('')),
  expiresAt: z.iso.datetime().optional().nullable(),
  reference: z.string().trim().max(64).optional().or(z.literal('')),
  successRedirectUrl: z.url().optional().or(z.literal('')),
  cancelRedirectUrl: z.url().optional().or(z.literal('')),
});

export const checkoutFromLinkSchema = z.object({
  email: z.email(),
  name: z.string().trim().max(160).optional(),
  amount: z.number().int().min(10_000).max(1_000_000_000_00).optional(),
});

export const customerSchema = z.object({
  email: z.email(),
  name: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(20).optional(),
});

export const refundSchema = z.object({
  payment: z.string().min(3),
  amount: z.number().int().positive().optional(),
  reason: z.string().trim().max(300).optional(),
});

export const withdrawalSchema = z.object({
  amount: z.number().int().min(100_00),
  bankAccountId: z.uuid(),
});

export const merchantWebhookSchema = z.object({
  url: z.url().refine((u) => u.startsWith('https://') || u.startsWith('http://localhost'), 'Webhook URL must use HTTPS'),
  events: z.array(z.enum(WEBHOOK_EVENT_TYPES)).min(1),
  enabled: z.boolean().default(true),
});

export const inviteMemberSchema = z.object({
  email: z.email(),
  role: z.enum(MERCHANT_ROLES).refine((r) => r !== 'owner', 'Cannot invite another owner'),
});

export const feeScheduleSchema = z.object({
  organizationId: z.uuid().nullable(),
  percentageBps: z.number().int().min(0).max(1000),
  fixedFee: z.number().int().min(0),
  minFee: z.number().int().min(0),
  maxFee: z.number().int().min(0).nullable(),
  payoutFee: z.number().int().min(0),
});

export const settlementPreferenceSchema = z.object({
  schedule: z.enum(SETTLEMENT_SCHEDULES),
});
