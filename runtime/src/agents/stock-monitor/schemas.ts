import { z } from 'zod';

export const StockMonitorInputSchema = z.object({
  productId: z.number().int().positive(),
  productUrl: z.string().url().optional(),
  postalCode: z.string().optional(),
  watchedStoreIds: z.array(z.number().int().positive()).optional(),
});

export type StockMonitorInput = z.infer<typeof StockMonitorInputSchema>;

export const StoreWithStockSchema = z.object({
  storeId: z.number(),
  name: z.string(),
  stockCount: z.number(),
});

export type StoreWithStock = z.infer<typeof StoreWithStockSchema>;

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
  storesWithStock: z.array(StoreWithStockSchema),
  storeStockChanged: z.boolean(),
});

export type StockMonitorOutput = z.infer<typeof StockMonitorOutputSchema>;
