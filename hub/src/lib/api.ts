const BASE = '/hub/api';

function getToken(): string | null {
  return localStorage.getItem('hub_token');
}

export function setToken(token: string): void {
  localStorage.setItem('hub_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('hub_token');
}

export function hasToken(): boolean {
  return !!getToken();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  sendCode: (email: string) =>
    request<{ ok: boolean; message: string }>('/auth/send-code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  verifyCode: (email: string, code: string) =>
    request<{ ok: boolean; token: string; expiresAt: string }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  me: () => request<{ email: string }>('/auth/me'),

  // Weather
  weather: () => request<WeatherData>('/weather'),

  // Transport
  transport: () => request<TransportData>('/transport'),

  // Meals
  mealsWeek: () => request<MealsWeekData>('/meals/week'),
  rateMeal: (data: { dayOfWeek: number; rating?: number; feedbackEmoji?: string }) =>
    request<{ ok: boolean }>('/meals/rate', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Recipes
  recipes: () => request<{ recipes: Recipe[] }>('/recipes'),
  recipe: (id: string) => request<RecipeDetail>(`/recipes/${id}`),

  // Shopping
  shopping: () => request<ShoppingData>('/shopping'),
  addShoppingItems: (items: Array<{ name: string; amount?: number; unit?: string; category?: string }>) =>
    request<{ ok: boolean }>('/shopping/items', {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  toggleShoppingItem: (id: string, checked: boolean) =>
    request<{ ok: boolean }>(`/shopping/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ checked }),
    }),
  deleteShoppingItem: (id: string) =>
    request<{ ok: boolean }>(`/shopping/items/${id}`, {
      method: 'DELETE',
    }),
};

// Types
export interface WeatherData {
  current: {
    time: string;
    temperature: number;
    windSpeed: number;
    windDirection: number;
    humidity: number;
    precipitation: number;
    symbolCode: string;
  };
  hourly: Array<{
    time: string;
    temperature: number;
    precipitation: number;
    symbolCode: string;
  }>;
  daily: Array<{
    date: string;
    minTemp: number;
    maxTemp: number;
    symbolCode: string;
    precipitation: number;
  }>;
  updatedAt: string;
}

export interface TransportData {
  stopName: string;
  departures: Array<{
    line: string;
    destination: string;
    departureTime: string;
    aimedTime: string;
    realtime: boolean;
    delayed: boolean;
    delayMinutes: number;
    cancelled: boolean;
    transportMode: string;
  }>;
  updatedAt: string;
}

export interface MealsWeekData {
  plan: {
    planId: string | null;
    weekNumber: number;
    year: number;
    status: string;
    meals: Array<{
      dayOfWeek: number;
      dayName: string;
      name: string;
      description: string | null;
      mealType: string;
      yieldsLeftovers: boolean;
    }>;
  };
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  prep_time_min: number | null;
  cook_time_min: number | null;
  servings: number;
}

export interface RecipeDetail {
  recipe: Recipe & { nutrition_per_serving: Record<string, number> | null };
  ingredients: Array<{
    id: string;
    name: string;
    amount: number | null;
    unit: string | null;
    ingredient_group: string | null;
  }>;
  steps: Array<{
    id: string;
    step_number: number;
    instruction: string;
    duration_min: number | null;
  }>;
}

export interface ShoppingData {
  listId: string;
  items: Array<{
    id: string;
    name: string;
    amount: number | null;
    unit: string | null;
    category: string | null;
    checked: boolean;
  }>;
}
