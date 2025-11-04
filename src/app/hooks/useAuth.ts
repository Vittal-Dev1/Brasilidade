"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function useAuth(protectedRoute = true) {
  const [token, setToken] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem("token");
    if (stored) {
      setToken(stored);
    } else if (protectedRoute) {
      router.push("/login");
    }
  }, [router, protectedRoute]);

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    router.push("/login");
  };

  return { token, logout, isAuthenticated: !!token };
}