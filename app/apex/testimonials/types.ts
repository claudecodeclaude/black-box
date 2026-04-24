export type Testimonial = {
  number: number;
  text: string;
  createdAt: string;
};

export type TestimonialsState = {
  testimonials: Testimonial[];
  nextNumber: number;
};

export const EMPTY_STATE: TestimonialsState = {
  testimonials: [],
  nextNumber: 1,
};

export type Match = {
  number: number;
  reason: string;
};

export type MatchResponse = {
  matches: Match[];
};

export type PastEntry = {
  id: string;
  createdAt: string;   // ISO UTC
  notes: string;
  matches: Match[];
};

export type LogsState = {
  entries: PastEntry[];
};

export const EMPTY_LOGS: LogsState = { entries: [] };
