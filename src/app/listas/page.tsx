// src/app/listas/page.tsx
"use client";

import { useEffect, useState, MouseEventHandler } from "react";
import { motion } from "framer-motion";
import {
  Database,
  Users,
  Loader2,
  RefreshCw,
  Pencil,
  X,
  Check,
  Plus,
  Trash2,
  Save,
} from "lucide-react";

/** Tipos de dados */
type Contato = { nome: string; numero: string };
type ListaResumo = { id: number; nome: string; created_at?: string };
type TemplateVariation = { base: string; variations: string[] };
type ApiLista = {
  id: number;
  nome: string;
  contatos: Contato[];
  templates?: TemplateVariation[];
  reply_templates?: TemplateVariation[];
  reply_message?: string | null; // caso o backend ainda use campo antigo
};

/** Utils */
function normalizeMsisdn(raw: string): string {
  const d = String(raw || "").replace(/\D+/g, "").replace(/^0+/, "");
  // Brasil: se vier DDD+numero (10/11), prefixa 55
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export default function ListasPage() {
  /** Estado principal */
  const [listas, setListas] = useState<ListaResumo[]>([]);
  const [selected, setSelected] = useState<number | null>(null);

  // Dados da lista carregada
  const [listaNome, setListaNome] = useState<string>("");
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [templates, setTemplates] = useState<TemplateVariation[]>([]);
  const [replyTemplates, setReplyTemplates] = useState<TemplateVariation[]>([]);

  // UI/controle
  const [loadingListas, setLoadingListas] = useState(false);
  const [loadingContatos, setLoadingContatos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedContato, setEditedContato] = useState<Contato | null>(null);

  // Modo criação de nova lista
  const [novoNome, setNovoNome] = useState<string>("");

  /** Buscar listas (resumo) */
  const fetchListas = async () => {
    try {
      setLoadingListas(true);
      const r = await fetch("/api/listas", { cache: "no-store" });
      const data = (await r.json()) as ListaResumo[] | { error?: string };
      if (Array.isArray(data)) setListas(data);
    } catch (e) {
      console.error("💥 Falha ao listar listas:", e);
    } finally {
      setLoadingListas(false);
    }
  };

  /** Carregar lista completa (nome, contatos, templates etc.) */
  const loadLista = async (id: number) => {
    setLoadingContatos(true);
    try {
      const r = await fetch(`/api/listas/${id}`, { cache: "no-store" });
      if (!r.ok) {
        if (r.status === 404) {
          console.warn(`⚠️ Lista #${id} não encontrada. Atualizando resumo…`);
          await fetchListas();
          setSelected(null);
          setListaNome("");
          setContatos([]);
          setTemplates([]);
          setReplyTemplates([]);
          return;
        }
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `Falha ao carregar lista #${id}`);
      }
      const lista = (await r.json()) as ApiLista;

      setSelected(lista.id);
      setListaNome(lista.nome || "");
      setContatos(Array.isArray(lista.contatos) ? lista.contatos : []);

      // templates
      const tpls =
        Array.isArray(lista.templates) && lista.templates.length
          ? lista.templates
          : [{ base: "Olá {{nome}}!", variations: [] }];
      setTemplates(tpls);

      // reply templates: aceita os dois formatos (novo e legado)
      const rtpls =
        Array.isArray(lista.reply_templates) && lista.reply_templates.length
          ? lista.reply_templates
          : typeof lista.reply_message === "string" && lista.reply_message.trim()
          ? [{ base: lista.reply_message, variations: [] }]
          : [{ base: "Oi {{nome}}, recebemos sua mensagem! 👋", variations: [] }];
      setReplyTemplates(rtpls);
    } catch (e) {
      console.error("💥 Erro ao carregar lista:", e);
    } finally {
      setLoadingContatos(false);
    }
  };

  useEffect(() => {
    fetchListas();
  }, []);

  /** Editar contato (linha) */
  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditedContato({ ...contatos[index] });
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditedContato(null);
  };

  const handleSaveContato = async (index: number) => {
    if (!selected || !editedContato) return;
    if (!editedContato.nome.trim() || !editedContato.numero.trim()) {
      console.warn("⚠️ Nome e número são obrigatórios.");
      return;
    }

    try {
      setSaving(true);
      // 1) Busca foto da lista atualizada (segura para pegar tudo)
      const res = await fetch(`/api/listas/${selected}`, { cache: "no-store" });
      if (!res.ok) {
        if (res.status === 404) {
          console.error("❌ Lista não encontrada. Atualizando resumo.");
          await fetchListas();
          setSelected(null);
          setContatos([]);
        }
        return;
      }
      const lista = (await res.json()) as ApiLista;

      // 2) atualiza contatos localmente
      const updated = [...(lista.contatos || [])];
      updated[index] = {
        nome: editedContato.nome.trim(),
        numero: normalizeMsisdn(editedContato.numero.trim()),
      };

      // 3) PUT com os nomes de campo aderentes ao backend
      const updateRes = await fetch(`/api/listas/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: lista.nome,
          templates: templates, // mantém os atuais da UI
          reply_templates: replyTemplates,
          contatos: updated,
        }),
      });

      if (!updateRes.ok) {
        const err = await updateRes.json().catch(() => ({}));
        console.error("❌ Erro no servidor:", err?.error || updateRes.statusText);
        if (updateRes.status === 404) {
          console.warn("⚠️ A API retornou 404. Vamos recriar a lista.");
          const post = await fetch(`/api/listas`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nome: lista.nome,
              templates,
              reply_templates: replyTemplates,
              contatos: updated,
            }),
          });
          const pj = await post.json().catch(() => ({}));
          if (post.ok && pj?.id) {
            setSelected(Number(pj.id));
            await fetchListas();
            await loadLista(Number(pj.id));
            console.info(`✅ Lista recriada como #${pj.id}`);
          } else {
            console.error("💥 Falha ao recriar lista:", pj?.error || post.statusText);
          }
        }
        return;
      }

      // 4) UI local
      const local = [...contatos];
      local[index] = {
        nome: editedContato.nome.trim(),
        numero: normalizeMsisdn(editedContato.numero.trim()),
      };
      setContatos(local);
      setEditingIndex(null);
      setEditedContato(null);
      console.info("✅ Contato atualizado.");
    } catch (e) {
      console.error("💥 Erro ao salvar contato:", e);
    } finally {
      setSaving(false);
    }
  };

  /** Remover contato da lista */
  const handleRemoveContato = async (index: number) => {
    if (selected == null) return;
    try {
      setSaving(true);

      const updated = contatos.filter((_, i) => i !== index);
      const r = await fetch(`/api/listas/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: listaNome,
          templates,
          reply_templates: replyTemplates,
          contatos: updated,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.error("❌ Erro ao remover:", j?.error || r.statusText);
        return;
      }
      setContatos(updated);
    } catch (e) {
      console.error("💥 Erro ao remover contato:", e);
    } finally {
      setSaving(false);
    }
  };

  /** Adicionar novo contato (na lista carregada) */
  const handleAddContato = async () => {
    if (selected == null) return;
    const novo: Contato = { nome: "Novo contato", numero: "" };
    const updated = [...contatos, novo];
    try {
      setSaving(true);
      const r = await fetch(`/api/listas/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: listaNome,
          templates,
          reply_templates: replyTemplates,
          contatos: updated,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.error("❌ Erro ao adicionar:", j?.error || r.statusText);
        return;
      }
      setContatos(updated);
      setEditingIndex(updated.length - 1);
      setEditedContato({ ...novo });
    } catch (e) {
      console.error("💥 Erro ao adicionar contato:", e);
    } finally {
      setSaving(false);
    }
  };

  /** Renomear a lista carregada */
  const handleRenameLista = async () => {
    if (selected == null) return;
    try {
      setSaving(true);
      const r = await fetch(`/api/listas/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: listaNome.trim() || `Lista ${selected}`,
          templates,
          reply_templates: replyTemplates,
          contatos,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("❌ Erro ao renomear:", j?.error || r.statusText);
        return;
      }
      // se o backend recriar com novo id:
      if (j?.id && j.id !== selected) {
        setSelected(Number(j.id));
      }
      await fetchListas();
      console.info("✅ Nome atualizado.");
    } catch (e) {
      console.error("💥 Erro ao renomear lista:", e);
    } finally {
      setSaving(false);
    }
  };

  /** Criar lista nova nesta página */
  const handleCreateLista: MouseEventHandler<HTMLButtonElement> = async (e) => {
    e.preventDefault();
    const nome = novoNome.trim();
    if (!nome) {
      console.warn("⚠️ Informe um nome para a nova lista.");
      return;
    }
    try {
      setSaving(true);
      const r = await fetch("/api/listas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          templates: [{ base: "Olá {{nome}}!", variations: [] }],
          reply_templates: [{ base: "Oi {{nome}}, recebemos sua mensagem! 👋", variations: [] }],
          contatos: [],
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("❌ Erro ao criar lista:", j?.error || r.statusText);
        return;
      }
      const newId = Number(j?.id);
      console.info(`✅ Lista criada (#${newId})`);
      setNovoNome("");
      await fetchListas();
      if (newId) {
        setSelected(newId);
        await loadLista(newId);
      }
    } catch (err) {
      console.error("💥 Erro ao criar lista:", err);
    } finally {
      setSaving(false);
    }
  };

  /** Cabeçalho */
  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-900 via-zinc-950 to-black px-6 py-10 text-white">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Users className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold">Listas & Contatos</h1>
              <p className="text-sm text-zinc-400">Crie, selecione e edite as listas no mesmo lugar.</p>
            </div>
          </div>

          <button
            onClick={fetchListas}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition"
          >
            <RefreshCw className={`h-4 w-4 ${loadingListas ? "animate-spin" : ""}`} /> Atualizar
          </button>
        </div>

        {/* Criar nova lista */}
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-8">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-sm text-zinc-400 mb-1">Nova lista</label>
              <input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Ex.: Campanha Novembro SP"
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={handleCreateLista}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2 text-sm font-medium disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Criar lista
            </button>
          </div>
        </div>

        {/* Selecionar lista existente */}
        <div className="mb-6">
          <label className="block text-sm text-zinc-400 mb-2">Selecione uma lista</label>
          <div className="relative">
            <select
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 text-zinc-100 px-3 py-2 text-sm appearance-none outline-none focus:ring-2 focus:ring-indigo-500"
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelected(id || null);
                if (id) loadLista(id);
                else {
                  setListaNome("");
                  setContatos([]);
                  setTemplates([]);
                  setReplyTemplates([]);
                }
              }}
              value={selected ?? ""}
            >
              <option value="">— Escolha uma lista —</option>
              {listas.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nome} (#{l.id})
                </option>
              ))}
            </select>
            <Database className="absolute right-3 top-2.5 h-4 w-4 text-zinc-500 pointer-events-none" />
          </div>
        </div>

        {/* Editor da lista selecionada */}
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
          >
            {/* Header da lista */}
            <div className="px-5 py-4 border-b border-zinc-800 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-medium flex items-center gap-2">
                  <Users className="h-5 w-5 text-indigo-400" />
                  Lista #{selected}
                </h2>
                <p className="text-xs text-zinc-500 mt-1">Total de contatos: {contatos.length}</p>
              </div>

              <div className="flex items-end gap-2 w-full md:w-auto">
                <div className="flex-1">
                  <label className="block text-xs text-zinc-400 mb-1">Nome da lista</label>
                  <input
                    value={listaNome}
                    onChange={(e) => setListaNome(e.target.value)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={handleRenameLista}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-sm font-medium disabled:opacity-60"
                >
                  <Save className="h-4 w-4" /> Salvar nome
                </button>
              </div>
            </div>

            {/* Tabela de contatos */}
            <div className="overflow-auto max-h-[60vh]">
              <table className="w-full text-sm text-zinc-300">
                <thead className="sticky top-0 bg-zinc-950/80 backdrop-blur-sm">
                  <tr>
                    <th className="text-left px-5 py-3 font-medium text-zinc-400 w-12">#</th>
                    <th className="text-left px-5 py-3 font-medium text-zinc-400">Nome</th>
                    <th className="text-left px-5 py-3 font-medium text-zinc-400">Número</th>
                    <th className="text-right px-5 py-3 font-medium text-zinc-400 w-36">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingContatos ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-zinc-500">
                        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                        Carregando…
                      </td>
                    </tr>
                  ) : contatos.length ? (
                    contatos.map((c, i) => (
                      <tr key={i} className="hover:bg-zinc-800/50 transition border-b border-zinc-800/50">
                        <td className="px-5 py-3 text-zinc-400">{i + 1}</td>

                        <td className="px-5 py-3">
                          {editingIndex === i ? (
                            <input
                              value={editedContato?.nome ?? ""}
                              onChange={(e) =>
                                setEditedContato((prev) => ({
                                  ...(prev as Contato),
                                  nome: e.target.value,
                                }))
                              }
                              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          ) : (
                            c.nome || "—"
                          )}
                        </td>

                        <td className="px-5 py-3">
                          {editingIndex === i ? (
                            <input
                              value={editedContato?.numero ?? ""}
                              onChange={(e) =>
                                setEditedContato((prev) => ({
                                  ...(prev as Contato),
                                  numero: e.target.value,
                                }))
                              }
                              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-2 py-1 text-sm text-zinc-100 outline-none focus:ring-2 focus:ring-indigo-500"
                            />
                          ) : (
                            c.numero || "—"
                          )}
                        </td>

                        <td className="px-5 py-3 text-right">
                          {editingIndex === i ? (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleSaveContato(i)}
                                disabled={saving}
                                className="p-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-60"
                                title="Salvar"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={handleCancel}
                                className="p-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white"
                                title="Cancelar"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <button
                                onClick={() => handleEdit(i)}
                                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                                title="Editar"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleRemoveContato(i)}
                                className="p-1.5 rounded-lg bg-zinc-700 hover:bg-zinc-800 text-white"
                                title="Remover"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-zinc-500">
                        Nenhum contato nesta lista.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Ações da lista */}
            <div className="px-5 py-4 border-t border-zinc-800 flex justify-between items-center">
              <button
                onClick={handleAddContato}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" /> Adicionar contato
              </button>

              {saving && (
                <span className="text-xs text-zinc-400">
                  <Loader2 className="inline h-3.5 w-3.5 animate-spin mr-1" />
                  salvando alterações…
                </span>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
