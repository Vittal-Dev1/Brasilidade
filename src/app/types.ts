// src/app/types.ts
export type CSVRow = Record<string, string>;

export type TemplateVariation = {
  base: string;
  variations: string[];
};

export type ListaDisparos = {
  id: number;
  nome: string;
  templates: TemplateVariation[];
  reply_message: string | null;
  contatos: CSVRow[];
  created_at: string;
};
