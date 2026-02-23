import { z } from 'zod';

export const FamilyContextSchema = z.object({
  adults: z.number().int().min(1),
  children: z.number().int().min(0),
  allergies: z.array(z.string()),
  dislikes: z.array(z.string()),
  cuisinePreferences: z.array(z.string()),
});

export type FamilyContext = z.infer<typeof FamilyContextSchema>;

export const SeasonalProduceItemSchema = z.object({
  name: z.string(),
  category: z.string(),
});

export const TraditionItemSchema = z.object({
  name: z.string(),
  country: z.string(),
  period: z.string(),
  typicalDishes: z.array(z.string()),
  suggestStrength: z.enum(['hint', 'suggest', 'strong']),
  description: z.string(),
});

export const RecentMealSchema = z.object({
  name: z.string(),
  dayOfWeek: z.number().int().min(1).max(7),
  feedbackEmoji: z.string().optional(),
});

export const NutritionGuidelineSchema = z.object({
  category: z.string(),
  topic: z.string(),
  content: z.string(),
  appliesTo: z.string().optional(),
});

export const InventoryNoteSchema = z.object({
  itemName: z.string(),
  status: z.string(),
  quantity: z.string().optional(),
});

export const MealPlanInputSchema = z.object({
  weekNumber: z.number().int().min(1).max(53),
  year: z.number().int().min(2024),
  householdId: z.string().optional(),
  family: FamilyContextSchema.optional(),
  seasonalProduce: z.array(SeasonalProduceItemSchema).optional(),
  traditions: z.array(TraditionItemSchema).optional(),
  recentMeals: z.array(RecentMealSchema).optional(),
  nutritionGuidelines: z.array(NutritionGuidelineSchema).optional(),
  pantryStaples: z.array(z.string()).optional(),
  inventoryNotes: z.array(InventoryNoteSchema).optional(),
  daysToPlan: z.number().int().min(1).max(7).optional(),
  mealsPerDay: z.number().int().min(1).max(3).optional(),
});

export type MealPlanInput = z.infer<typeof MealPlanInputSchema>;

export const MealIngredientSchema = z.object({
  name: z.string(),
  amount: z.string(),
});

export const PlannedMealSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(7),
  dayName: z.string(),
  name: z.string(),
  description: z.string(),
  estimatedPrepMin: z.number(),
  tags: z.array(z.string()),
  keyNutrients: z.array(z.string()),
  seasonalIngredients: z.array(z.string()),
  childTip: z.string().optional(),
  batchNote: z.string().optional(),
  ingredients: z.array(MealIngredientSchema),
});

export type PlannedMeal = z.infer<typeof PlannedMealSchema>;

export const MealPlanOutputSchema = z.object({
  weekNumber: z.number(),
  year: z.number(),
  meals: z.array(PlannedMealSchema),
  weekSummary: z.string(),
  nutritionNotes: z.string(),
  seasonalHighlight: z.string().optional(),
  traditionNote: z.string().optional(),
  shoppingHighlights: z.array(z.string()),
  hasMeals: z.boolean(),
});

export type MealPlanOutput = z.infer<typeof MealPlanOutputSchema>;
