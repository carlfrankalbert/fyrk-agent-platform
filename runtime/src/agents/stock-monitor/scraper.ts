export interface PowerStockResult {
  productId: number;
  title: string;
  price: number;
  stockCount: number;
  storesStockCount: number;
  webStockStatus: 1 | 2 | 3;
  canAddToCart: boolean;
  clickNCollectStoreCount: number;
  stockDeliveryDate: string | null;
}

export interface StoreStockResult {
  storeId: number;
  name: string;
  storeStockCount: number;
  clickNCollect: boolean;
}

export async function fetchStoreStock(productId: number, postalCode: string): Promise<StoreStockResult[]> {
  const url = `https://www.power.no/api/v2/products/${productId}/stores?postalCode=${postalCode}`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Power.no store API returned HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>[];

  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((store) => ({
    storeId: store.storeId as number,
    name: store.name as string,
    storeStockCount: store.storeStockCount as number,
    clickNCollect: store.clickNCollect as boolean,
  }));
}

export async function fetchStockStatus(productId: number): Promise<PowerStockResult> {
  const url = `https://www.power.no/api/v2/products?ids=${productId}`;

  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Power.no API returned HTTP ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>[];

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Product ${productId} not found`);
  }

  const product = data[0];

  return {
    productId: product.productId as number,
    title: product.title as string,
    price: product.price as number,
    stockCount: product.stockCount as number,
    storesStockCount: product.storesStockCount as number,
    webStockStatus: product.webStockStatus as 1 | 2 | 3,
    canAddToCart: product.canAddToCart as boolean,
    clickNCollectStoreCount: product.clickNCollectStoreCount as number,
    stockDeliveryDate: (product.stockDeliveryDate as string) ?? null,
  };
}
