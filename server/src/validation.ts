import { z } from 'zod';
import { BLOOD_TYPES } from '../../shared/apiTypes.js';
export const bloodTypeSchema = z.enum(BLOOD_TYPES);
export const requestSchema = z
  .object({ recipientType: bloodTypeSchema, quantity: z.number().int().positive().max(1000000) })
  .strict();
export const confirmSchema = requestSchema
  .extend({
    lines: z
      .array(
        z
          .object({
            bloodType: bloodTypeSchema,
            quantity: z.number().int().positive().max(1000000),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export const donationSchema = z
  .object({
    bloodType: bloodTypeSchema,
    donationDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date in YYYY-MM-DD format.')
      .refine((value) => {
        const date = new Date(`${value}T00:00:00Z`);
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }, 'Enter a real calendar date.')
      .refine(
        (value) =>
          value <=
          new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jerusalem',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date()),
        'Donation date cannot be in the future.',
      ),
    donorId: z
      .string()
      .trim()
      .regex(/^\d{9}$/, 'Enter a 9-digit donor ID, including leading zeros.'),
    donorFullName: z.string().trim().min(2, 'Enter the donor’s full name.').max(120),
  })
  .strict();
export const requestKeySchema = z.string().uuid();
