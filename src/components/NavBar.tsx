"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X, Sparkles, LogOut } from "lucide-react";

export default function Navbar({ dark, onLogout }: { dark: boolean; onLogout: () => void }) {
  const [open, setOpen] = useState(false);

const links = [
  { href: "/", label: "Disparador" },
  { href: "/historico", label: "Histórico" },
  { href: "/listas", label: "Listas" },
  { href: "/n8n", label: "N8N" },
  { href: "/envioArquivos", label: "Enviar Arquivos" },
];


  const bg = dark ? "bg-zinc-900/80 backdrop-blur border-zinc-800" : "bg-white/80 backdrop-blur border-zinc-200";
  const text = dark ? "text-zinc-100" : "text-zinc-900";
  const border = dark ? "border-zinc-800" : "border-zinc-200";

  return (
    <nav className={`sticky top-0 z-50 border-b ${bg}`}>
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-md shadow-indigo-500/20">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className={`font-semibold ${text}`}>Painel</span>
        </div>

        {/* Links - Desktop */}
        <div className="hidden md:flex items-center gap-6">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`text-sm font-medium hover:text-indigo-500 transition ${text}`}
            >
              {link.label}
            </Link>
          ))}
          <button
            onClick={onLogout}
            className="flex items-center gap-1 text-sm text-rose-500 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </div>

        {/* Mobile button */}
        <button onClick={() => setOpen(true)} className="md:hidden">
          <Menu className={`h-6 w-6 ${text}`} />
        </button>
      </div>

      {/* Drawer Mobile */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className={`fixed top-0 right-0 h-full w-64 ${bg} border-l ${border} shadow-xl flex flex-col`}
          >
            <div className="flex items-center justify-between p-4">
              <span className={`font-semibold ${text}`}>Menu</span>
              <button onClick={() => setOpen(false)}>
                <X className={`h-5 w-5 ${text}`} />
              </button>
            </div>

            <div className="flex flex-col gap-4 px-4 mt-4">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`text-sm font-medium hover:text-indigo-500 transition ${text}`}
                >
                  {link.label}
                </Link>
              ))}
              <button
                onClick={() => { setOpen(false); onLogout(); }}
                className="flex items-center gap-2 text-sm text-rose-500 hover:text-rose-600 mt-2"
              >
                <LogOut className="h-4 w-4" /> Sair
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
