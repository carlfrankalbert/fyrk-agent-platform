import { z } from 'zod';

// Slack Events API schemas for Husmor app

// --- URL verification ---
export const HusmorSlackChallengeSchema = z.object({
  type: z.literal('url_verification'),
  challenge: z.string(),
  token: z.string(),
});

// --- Reaction events ---
export const HusmorSlackReactionEvent = z.object({
  type: z.literal('reaction_added'),
  user: z.string(),
  reaction: z.string(),
  item: z.object({
    type: z.literal('message'),
    channel: z.string(),
    ts: z.string(),
  }),
  event_ts: z.string(),
});

// --- Message events ---
export const HusmorSlackMessageEvent = z.object({
  type: z.literal('message'),
  user: z.string().optional(),
  text: z.string().optional(),
  ts: z.string(),
  channel: z.string(),
  thread_ts: z.string().optional(),
  bot_id: z.string().optional(),
  subtype: z.string().optional(),
  event_ts: z.string().optional(),
});

export type HusmorSlackMessage = z.infer<typeof HusmorSlackMessageEvent>;

// --- Loose envelope parse (supports both reaction_added and message events) ---
export const HusmorSlackEventEnvelope = z.object({
  type: z.string(),
  token: z.string().optional(),
  challenge: z.string().optional(),
  event: z.record(z.unknown()).optional(),
});

export type HusmorSlackEnvelope = z.infer<typeof HusmorSlackEventEnvelope>;

// --- Action schemas (Claude response actions) ---
const AddMealsAction = z.object({
  type: z.literal('add_meals'),
  meals: z.array(z.object({
    dayOfWeek: z.number().int().min(1).max(7),
    name: z.string(),
    description: z.string().optional(),
    mealType: z.string().optional(),
  })),
});

const UpdateMealAction = z.object({
  type: z.literal('update_meal'),
  dayOfWeek: z.number().int().min(1).max(7),
  name: z.string(),
  description: z.string().optional(),
});

const RemoveMealAction = z.object({
  type: z.literal('remove_meal'),
  dayOfWeek: z.number().int().min(1).max(7),
});

const SetPreferenceAction = z.object({
  type: z.literal('set_preference'),
  key: z.string(),
  value: z.unknown(),
});

const AddInventoryNoteAction = z.object({
  type: z.literal('add_inventory_note'),
  itemName: z.string(),
  status: z.string().optional(),
  quantity: z.string().optional(),
});

const RateMealAction = z.object({
  type: z.literal('rate_meal'),
  dayOfWeek: z.number().int().min(1).max(7),
  feedbackEmoji: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

const GenerateShoppingListAction = z.object({
  type: z.literal('generate_shopping_list'),
  items: z.array(z.object({
    name: z.string(),
    amount: z.string().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
  })).min(1),
});

const UpdatePlanStatusAction = z.object({
  type: z.literal('update_plan_status'),
  status: z.enum(['draft', 'proposed', 'approved', 'active', 'completed']),
});

const ProposeLearningAction = z.object({
  type: z.literal('propose_learning'),
  category: z.enum(['preference', 'household_info', 'feedback', 'constraint', 'routine']),
  insight: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

export const HusmorActionSchema = z.discriminatedUnion('type', [
  AddMealsAction,
  UpdateMealAction,
  RemoveMealAction,
  SetPreferenceAction,
  AddInventoryNoteAction,
  RateMealAction,
  GenerateShoppingListAction,
  UpdatePlanStatusAction,
  ProposeLearningAction,
]);

export type HusmorAction = z.infer<typeof HusmorActionSchema>;

export const HusmorClaudeResponseSchema = z.object({
  reply: z.string(),
  actions: z.array(HusmorActionSchema).optional(),
});

export type HusmorClaudeResponse = z.infer<typeof HusmorClaudeResponseSchema>;
