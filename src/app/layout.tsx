import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ClientShell from "../components/ClientShell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Painel de Disparos",
  description: "Sistema de disparos com IA, listas e histórico",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.className}>
        <ClientShell>{children}</ClientShell>
      </body>
    </html>
  );
}
