import { z } from 'zod';
import { BLOOD_TYPES, RECORD_DATASETS } from '../../shared/apiTypes.js';
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
const recordFilterFields = {
  dataset: z.enum(RECORD_DATASETS),
  search: z.string().trim().max(200).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  action: z.string().min(1).max(100).optional(),
  outcome: z.enum(['SUCCESS', 'REJECTED', 'ERROR']).optional(),
  snapshotAt: z.iso.datetime({ offset: true }).optional(),
};
function validRecordFilters(value: {
  dataset: string;
  action?: string;
  outcome?: string;
  from?: string;
  to?: string;
}) {
  return (
    !(value.from && value.to && value.from > value.to) &&
    (value.dataset === 'auditLogs' || (!value.action && !value.outcome))
  );
}
const recordFilterError =
  'Use an ordered date range; action and outcome filters apply only to audit logs.';
export const recordsQuerySchema = z
  .object({
    ...recordFilterFields,
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict()
  .refine(validRecordFilters, recordFilterError);
export const recordsExportSchema = z
  .object({
    filters: z.object(recordFilterFields).strict().refine(validRecordFilters, recordFilterError),
    ids: z
      .array(z.uuid())
      .min(1)
      .max(200)
      .refine((ids) => new Set(ids).size === ids.length, 'Select each record only once.')
      .optional(),
  })
  .strict();
export const cancellationSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('ROUTINE'),
      recipientType: bloodTypeSchema,
      quantity: z.number().int().positive().max(1000000),
    })
    .strict(),
  z.object({ operation: z.literal('EMERGENCY') }).strict(),
]);
