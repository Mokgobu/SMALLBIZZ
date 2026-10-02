import { httpsCallable } from 'firebase/functions'
import { collection, limit, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore'
import { requireFirebase } from '../config/firebase'
import type { KitchenOrder, KitchenStatus, MenuAvailability, Recipe, RecipeInput } from '../models/recipe'
import type { Product } from '../models/product'

export type RecipeCostPreview = {
  recipeId: string; version: number
  lines: Array<{ ingredientProductId: string; ingredientName: string; quantity: number; unit: string; unitCost: number; lineCost: number }>
  totalCost: number; sellingPrice: number; margin: number; marginPercent: number
}

export function createRestaurantService() {
  const { db, functions } = requireFirebase()
  const listRecipesCall = httpsCallable<Record<string, never>, { recipes: Recipe[]; products: Product[]; financialValuesIncluded: boolean }>(functions, 'listRecipes')
  const saveRecipeCall = httpsCallable<RecipeInput, { recipeId: string; version: number }>(functions, 'saveRecipe')
  const costCall = httpsCallable<{ recipeId: string }, RecipeCostPreview>(functions, 'getRecipeCostPreview')
  const menuCall = httpsCallable<Record<string, never>, { items: Array<MenuAvailability & Pick<Recipe, 'modifierGroups'>> }>(functions, 'getMenuCatalog')
  const kitchenCall = httpsCallable<Record<string, never>, { orders: KitchenOrder[] }>(functions, 'listKitchenOrders')
  const statusCall = httpsCallable<{ orderId: string; status: KitchenStatus }, { orderId: string; status: KitchenStatus }>(functions, 'updateKitchenOrderStatus')
  return {
    listRecipes: async () => (await listRecipesCall({})).data,
    saveRecipe: async (input: RecipeInput) => (await saveRecipeCall(input)).data,
    getRecipeCostPreview: async (recipeId: string) => (await costCall({ recipeId })).data,
    getMenuCatalog: async () => (await menuCall({})).data.items,
    listKitchenOrders: async () => (await kitchenCall({})).data.orders,
    subscribeKitchenOrders: (
      businessId: string,
      onData: (orders: KitchenOrder[]) => void,
      onError: (error: unknown) => void
    ): Unsubscribe => onSnapshot(
      query(collection(db, 'businesses', businessId, 'kitchenOrders'), orderBy('createdAt', 'desc'), limit(100)),
      (snapshot) => onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as KitchenOrder)),
      onError
    ),
    updateKitchenOrderStatus: async (orderId: string, status: KitchenStatus) => (await statusCall({ orderId, status })).data
  }
}
