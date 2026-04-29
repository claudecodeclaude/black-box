export type OfficeText = {
  id: string;
  from: string;
  to: string;
  body: string;
  receivedAt: string;
  numMedia: number;
  read: boolean;
  ghlForwarded: boolean;
  ghlError?: string;
};

export const OFFICE_TEXTS_LIMIT = 500;
