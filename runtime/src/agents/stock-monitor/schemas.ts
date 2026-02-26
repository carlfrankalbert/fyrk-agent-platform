import { z } from 'zod';

export const StockMonitorInputSchema = z.object({
  productId: z.number().int().positive(),
  productUrl: z.string().url().optional(),
});

export type StockMonitorInput = z.infer<typeof StockMonitorInputSchema>;

export const StockMonitorOutputSchema = z.object({
  productId: z.number(),
  title: z.string(),
  webStockStatus: z.number(),
  stockCount: z.number(),
  storesStockCount: z.number(),
  canAddToCart: z.boolean(),
  previousStatus: z.number().nullable(),
  statusChanged: z.boolean(),
  notificationSent: z.boolean(),
});

export type StockMonitorOutput = z.infer<typeof StockMonitorOutputSchema>;
