"use client";

import { useCallback, useState } from "react";

interface Lista {
  id: number;
  nome: string;
  created_at: string;
}

export function useListas(token?: string) {
  const [listas, setListas] = useState<Lista[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchListas = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/listas", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        console.error("❌ Erro ao carregar listas:", res.status);
        return;
      }

      const data = await res.json();
      if (Array.isArray(data)) {
        setListas(data);
      } else {
        console.error("❌ Resposta inesperada de /api/listas:", data);
      }
    } catch (err) {
      console.error("💥 Erro em fetchListas:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  const getLista = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/listas/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        console.error(`❌ Erro ao buscar lista ${id}:`, res.status);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.error("💥 Erro em getLista:", err);
      return null;
    }
  }, [token]);

  return { listas, loading, fetchListas, getLista };
}
