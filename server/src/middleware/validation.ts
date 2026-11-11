import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// Sanitization utility
export function sanitizeString(val: string): string {
  if (typeof val !== 'string') return val;
  return val
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/onload\s*=/gi, '')
    .replace(/onerror\s*=/gi, '')
    .trim();
}

// Password strength validator
export const passwordStrengthRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^()_\-+=\[\]{}|:;<>,./~`])[A-Za-z\d@$!%*?&#^()_\-+=\[\]{}|:;<>,./~`]{8,}$/;

// Schemas
export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').max(100).transform(sanitizeString),
  password: z.string().min(1, 'Password is required').max(128),
  role: z.enum(['admin', 'agent', 'customer']).optional()
});

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).transform(sanitizeString),
  email: z.string().email('Please enter a valid email address').max(100).transform(s => s.trim().toLowerCase()),
  phone: z.string().max(25).optional().nullable().transform(s => s ? sanitizeString(s) : null),
  password: z.string()
    .min(6, 'Password must be at least 6 characters long')
    .max(128, 'Password cannot exceed 128 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password')
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address').max(100).transform(s => s.trim().toLowerCase())
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32, 'Invalid reset token format').max(128),
  newPassword: z.string()
    .min(8, 'Password must be at least 8 characters long')
    .max(128, 'Password cannot exceed 128 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/\d/, 'Password must contain at least one digit')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z.string().min(1, 'Please confirm your password')
}).refine(data => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
});

export const customerCreateSchema = z.object({
  name: z.string().min(2).max(100).transform(sanitizeString),
  email: z.string().email().max(100).transform(s => s.trim().toLowerCase()),
  phone: z.string().max(25).optional().nullable().transform(s => s ? sanitizeString(s) : null),
  password: z.string().min(6).max(128)
});

export const customerUpdateSchema = z.object({
  name: z.string().min(2).max(100).optional().transform(s => s ? sanitizeString(s) : undefined),
  email: z.string().email().max(100).optional().transform(s => s ? s.trim().toLowerCase() : undefined),
  phone: z.string().max(25).optional().nullable().transform(s => s ? sanitizeString(s) : null)
});

export const knowledgeEntrySchema = z.object({
  title: z.string().min(2).max(200).transform(sanitizeString),
  category: z.string().max(50).default('general').transform(sanitizeString),
  question: z.string().max(500).optional().nullable().transform(s => s ? sanitizeString(s) : null),
  answer: z.string().max(5000).optional().nullable().transform(s => s ? sanitizeString(s) : null),
  content: z.string().min(5).max(50000).transform(sanitizeString),
  keywords: z.string().max(300).optional().nullable().transform(s => s ? sanitizeString(s) : null)
});

export const ticketCreateSchema = z.object({
  customerId: z.string().max(50).optional().nullable(),
  customerName: z.string().min(2).max(100).optional().transform(s => s ? sanitizeString(s) : undefined),
  customerEmail: z.string().email().max(100).optional().transform(s => s ? s.trim().toLowerCase() : undefined),
  subject: z.string().min(2).max(200).transform(sanitizeString),
  description: z.string().min(5).max(4000).transform(sanitizeString),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  assignedTo: z.string().max(100).optional().nullable().transform(s => s ? sanitizeString(s) : null),
  followUpAt: z.string().datetime().optional().nullable()
});

export const ticketUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'waiting', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedTo: z.string().max(100).optional().nullable().transform(s => s ? sanitizeString(s) : null),
  followUpAt: z.string().datetime().optional().nullable(),
  description: z.string().min(2).max(4000).optional().transform(s => s ? sanitizeString(s) : undefined)
});

export const callRatingSchema = z.object({
  rating: z.number().int().min(1).max(5)
});

export const callNotesSchema = z.object({
  notes: z.string().max(2000).transform(sanitizeString)
});

// Middleware generator
export function validate(schema: z.ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: err.issues.map(i => ({
            field: i.path.join('.'),
            message: i.message
          }))
        });
        return;
      }
      res.status(400).json({ error: 'Invalid request data' });
    }
  };
}
