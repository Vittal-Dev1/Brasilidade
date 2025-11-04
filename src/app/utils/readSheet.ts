// src/app/utils/readSheet.ts
import fs from "fs";
import Papa from "papaparse";

// Cada linha do CSV é dinâmica, mas garantimos "nome" e "numero" como strings.
export type Contato = {
  nome: string;
  numero: string;
} & Record<string, string>;

function detectDelimiter(sample: string): string {
  return sample.includes(";") ? ";" : ",";
}

export async function lerPlanilha(filePath: string): Promise<Contato[]> {
  const csv = await fs.promises.readFile(filePath, "utf8");

  const { data } = Papa.parse<Contato>(csv, {
    header: true,
    skipEmptyLines: true,
    delimiter: detectDelimiter(csv),
    transformHeader: (h) =>
      h
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, ""),
  });

  // filtra linhas vazias/undefined
  return (data as Contato[]).filter(Boolean);
}
