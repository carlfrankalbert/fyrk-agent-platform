import { z } from 'zod';

const RateMealAction = z.object({
  type: z.literal('rate_meal'),
  dayOfWeek: z.number().int().min(1).max(7),
  feedbackEmoji: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  feedbackText: z.string().max(300).optional(),
});

const LogChildReactionAction = z.object({
  type: z.literal('log_child_reaction'),
  childName: z.string(),
  mealName: z.string(),
  reaction: z.enum(['loved', 'liked', 'neutral', 'disliked', 'refused']),
  notes: z.string().optional(),
});

const AddShoppingItemsAction = z.object({
  type: z.literal('add_shopping_items'),
  items: z.array(z.object({
    name: z.string(),
    amount: z.union([z.string(), z.number().transform(String)]).optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
  })).min(1),
});

export const MealActionSchema = z.discriminatedUnion('type', [
  RateMealAction,
  LogChildReactionAction,
  AddShoppingItemsAction,
]);

export type MealAction = z.infer<typeof MealActionSchema>;
