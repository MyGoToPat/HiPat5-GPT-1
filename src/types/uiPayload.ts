export type MealItem = {

  name: string;

  portion_qty: number;

  portion_unit: string;

  calories?: number;

  protein_g?: number;

  carb_g?: number;

  fat_g?: number;

  fiber_g?: number | null;

};

export type MealVerifyCard = {

  type: "nutrition_log";

  mode: "log" | "inspect";

  items: MealItem[];

  actions: { id: "log" | "edit" | "done" | "cancel"; label: string }[];

};
