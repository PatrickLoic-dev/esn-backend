export type ImportRowError = { row: number; message: string };

export type ImportProductsResult = {
  created: number;
  errors: ImportRowError[];
};
