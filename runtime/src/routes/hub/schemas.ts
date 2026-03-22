import { z } from 'zod';

export const AddShoppingItemSchema = z.object({
  name: z.string().min(1),
  amount: z.number().optional(),
  unit: z.string().optional(),
  category: z.string().optional(),
});

export const AddShoppingItemsSchema = z.object({
  items: z.array(AddShoppingItemSchema).min(1),
});

export const RateMealSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  rating: z.number().int().min(1).max(5).optional(),
  feedbackEmoji: z.string().optional(),
  feedbackText: z.string().optional(),
});

export const QuickCommandSchema = z.object({
  message: z.string().min(1),
});
