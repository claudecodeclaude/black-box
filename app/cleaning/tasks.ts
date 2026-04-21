export type Category = "weekly" | "special" | "laundry";

export type Frequency =
  | { kind: "everyWeek" }
  | { kind: "cycleWeeks"; weeks: number[] }
  | { kind: "onceInCycle"; week: number }
  | { kind: "monthly"; months: number[]; week: number }
  | { kind: "yearly"; intervalYears: number; startYear: number; week: number };

export type CatalogItem = {
  id: string;
  name: string;
  category: Category;
  frequency: Frequency;
  description: string;
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const item = (
  name: string,
  category: Category,
  frequency: Frequency,
  description: string
): CatalogItem => ({ id: slug(name), name, category, frequency, description });

const WEEKLY: CatalogItem[] = [
  ["Bathroom Counters", "Wipe down bathroom countertops with disinfectant spray."],
  ["Toilets", "Scrub toilet bowl, wipe seat and exterior."],
  ["Swiffer Around Toilets", "Swiffer the floor around the base of each toilet."],
  ["Change Dishwand", "Swap out the dish wand for a fresh head."],
  ["Fill Dishwand", "Top off the dish wand with soap."],
  ["Kitchen Sink", "Scrub and sanitize the kitchen sink basin and fixtures."],
  ["Clean Countertops", "Wipe down all kitchen countertops."],
  ["Kitchen Table", "Clear and wipe the kitchen table."],
  ["TV Counter", "Dust and wipe the TV counter."],
  ["Coffee Tray", "Wipe the coffee tray and surrounding area."],
  ["Microwave", "Wipe inside and outside of the microwave."],
  ["Vacuum Upstairs", "Vacuum all upstairs carpeted areas."],
  ["Mop Under Table", "Pull out chairs and mop under the kitchen table."],
  ["Vacuum Downstairs", "Vacuum all downstairs carpeted areas."],
  ["Sanitize Watch", "Wipe watch band and face with sanitizer."],
  ["Sanitize Phone", "Wipe phone with sanitizing wipe."],
].map(([n, d]) => item(n, "weekly", { kind: "everyWeek" }, d));

const SPECIAL_13: CatalogItem[] = [
  ["Change Sheets", "Strip the bed and put on fresh sheets."],
  ["Sweep Stairs", "Sweep every step from top to bottom."],
  ["Clean Bathroom Mirrors", "Glass cleaner on all bathroom mirrors."],
].map(([n, d]) => item(n, "special", { kind: "cycleWeeks", weeks: [1, 3] }, d));

const SPECIAL_245: CatalogItem[] = [
  ["Change Pillowcases", "Swap pillowcases for fresh ones."],
  ["Deep Clean Tub", "Scrub tub walls and floor with bathroom cleaner."],
  ["Replace Shower Cups", "Replace any disposable shower cups."],
  ["Clean Patio Door", "Clean glass and track on the patio door."],
  ["Wipe Stainless Steel Appliances", "Wipe all stainless steel with appropriate cleaner."],
].map(([n, d]) => item(n, "special", { kind: "cycleWeeks", weeks: [2, 4, 5] }, d));

const SPECIAL_ONCE: CatalogItem[] = [
  ["Sanitize Door Knobs", 1, "Wipe every door knob with sanitizer."],
  ["Sanitize Light Switches", 1, "Wipe every light switch plate."],
  ["Sanitize Kitchen Pulls", 1, "Wipe cabinet and drawer pulls in the kitchen."],
  ["Clean Non-Bathroom Mirrors", 1, "Glass cleaner on mirrors outside bathrooms."],
  ["Replace Kids and Cody's Toothbrush", 1, "Replace toothbrushes for the kids and Cody."],
  ["Dust Upstairs and Downstairs", 2, "Dust all surfaces upstairs and down."],
  ["Pull Back Washer Seal and Inspect for Soil and Lint", 2, "Pull back the washer's rubber seal and clean out soil/lint."],
  ["Wipe Washer Glass Door", 2, "Wipe inside and outside of washer door glass."],
  ["Sanitize Remotes", 3, "Wipe all remote controls."],
  ["Kitchen Sink Disposal", 3, "Run disposal cleaner or ice + citrus."],
  ["Clean Dryer Drum", 3, "Wipe out the dryer drum."],
  ["Back Side of Toilet", 4, "Clean behind and around the back of each toilet."],
  ["Mop Upstairs", 4, "Mop all upstairs hard floors."],
  ["Clean Kreature Filter/Brush/Wheel/Chamber", 4, "Pop the Kreature open and clean its filter, brush, wheel, and chamber."],
  ["Clean Kreature Side Brush/Cliff Sensors/Charging Contacts", 4, "Clean the Kreature's side brush, cliff sensors, and charging contacts."],
  ["Dust Baseboards", 4, "Dust or wipe baseboards throughout the house."],
  ["Dust Front Porch", 4, "Sweep and dust the front porch."],
  ["Vacuum Weight Room and Back Basement", 5, "Vacuum the weight room and back basement."],
].map(([n, w, d]) =>
  item(n as string, "special", { kind: "onceInCycle", week: w as number }, d as string)
);

const SPECIAL_MONTHLY: CatalogItem[] = [
  ["Wash Master Comforter", [2, 5, 8, 11], 1, "Wash the master bedroom comforter."],
  ["Replace Jodi's Toothbrush", [1, 3, 5, 7, 9, 11], 1, "Replace Jodi's toothbrush."],
  ["Clean Microwave Grease Filter", [7, 1], 1, "Remove and clean the microwave grease filter."],
  ["Replace Microwave Charcoal Filter", [3, 9], 1, "Replace the microwave charcoal filter."],
  ["Change Coffee Filter", [1, 4, 7, 10], 2, "Change the coffee maker's water filter."],
  ["Descale Coffee Pot", [1, 4, 7, 10], 2, "Run descaling cycle on the coffee pot."],
  ["Descale Teapot", [1, 4, 7, 10], 2, "Descale the teapot with vinegar or descaler."],
  ["Clean Fridge", [3, 7, 11], 2, "Empty, wipe, and reorganize the fridge."],
  ["Replace Furnace Filter", [1, 7], 2, "Swap in a new furnace filter."],
  ["Check Water Softener Levels", [1, 3, 5, 7, 9, 11], 3, "Check salt level in the water softener; refill if low."],
  ["Replace Mop Head", [12], 3, "Put a new head on the mop."],
  ["Wash Mop Head", [3, 6, 9], 3, "Machine wash the mop head."],
  ["Clean Lint Screen", [4, 10], 3, "Deep clean the dryer lint screen with soap and water."],
  ["Replace Kreature Filter", [2, 6, 10], 4, "Swap the Kreature's filter for a new one."],
  ["Replace Kreature Brush", [4, 10], 4, "Swap the Kreature's brush for a new one."],
  ["Wipe Glass Tables", [2, 4, 6, 8, 10, 12], 4, "Glass cleaner on all glass tables."],
  ["Change Fridge Filter and Reset Filter Status", [5, 11], 4, "Replace fridge water filter and reset indicator."],
  ["Replace Air Filter", [6, 12], 4, "Replace the home air filter."],
  ["Use Afresh on Dishwasher", [2, 4, 6, 8, 10, 12], 5, "Run an Affresh tablet through the dishwasher."],
  ["Clean Dishwasher Filter", [2, 4, 6, 8, 10, 12], 5, "Remove and rinse the dishwasher filter."],
].map(([n, months, w, d]) =>
  item(
    n as string,
    "special",
    { kind: "monthly", months: months as number[], week: w as number },
    d as string
  )
);

const LAUNDRY: CatalogItem[] = [
  ["Wash Bath Mats", 2, "Wash all bath mats."],
  ["Wash Couch Blankets", 5, "Wash the couch throw blankets."],
  ["Wash Kids Shower Mat", 5, "Wash the kids' shower mat."],
].map(([n, w, d]) =>
  item(n as string, "laundry", { kind: "cycleWeeks", weeks: [w as number] }, d as string)
);

const SPECIAL_YEARLY: CatalogItem[] = [
  [
    "Replace Water Inlet Hose",
    5,
    2030,
    2,
    "Replace the washer's water inlet hose.",
  ],
  [
    "Remove Lint From Dryer",
    2,
    2027,
    3,
    "Pull the dryer out and remove lint from behind it and in the vent.",
  ],
].map(([n, interval, startYear, w, d]) =>
  item(
    n as string,
    "special",
    {
      kind: "yearly",
      intervalYears: interval as number,
      startYear: startYear as number,
      week: w as number,
    },
    d as string
  )
);

export const CATALOG: CatalogItem[] = [
  ...WEEKLY,
  ...SPECIAL_13,
  ...SPECIAL_245,
  ...SPECIAL_ONCE,
  ...SPECIAL_MONTHLY,
  ...SPECIAL_YEARLY,
  ...LAUNDRY,
];
