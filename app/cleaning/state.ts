import { Category, Frequency } from "./tasks";

export type CustomItem = {
  id: string;
  name: string;
  category: Category;
  frequency: Frequency;
  description: string;
  createdAt: string;
};

export type ItemStateValue = "checked" | "pushed" | "skipped";

export type WeekState = {
  states: Record<string, ItemStateValue>;
};

export type GlobalState = {
  customItems: CustomItem[];
  overrides: Record<string, Partial<{ name: string; description: string; frequency: Frequency; category: Category }>>;
  removedIds: string[];
};

export const EMPTY_GLOBAL: GlobalState = {
  customItems: [],
  overrides: {},
  removedIds: [],
};

export const EMPTY_WEEK: WeekState = { states: {} };
