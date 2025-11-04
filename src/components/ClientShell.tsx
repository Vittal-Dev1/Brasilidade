"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Navbar from "../components/NavBar";

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [dark] = useState(true); // remover setDark elimina o warning
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token && pathname !== "/login") {
      router.replace("/login");
    } else {
      setAuthenticated(true);
    }
  }, [pathname, router]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    router.replace("/login");
  };

  // Se estiver na página de login, não renderiza navbar
  if (pathname === "/login") {
    return <>{children}</>;
  }

  // Enquanto verifica o token, evita flash de conteúdo
  if (authenticated === null) {
    return (
      <div className="min-h-screen bg-zinc-900 flex items-center justify-center text-white">
        Carregando...
      </div>
    );
  }

  return (
    <div className={dark ? "bg-zinc-900 min-h-screen" : "bg-zinc-100 min-h-screen"}>
      <Navbar dark={dark} onLogout={handleLogout} />
      <main className="pt-2">{children}</main>
    </div>
  );
}
