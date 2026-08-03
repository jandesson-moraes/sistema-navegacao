import React, { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../config/firebase";

const URL_GERENCIAR_ACESSO =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/gerenciarAcessoPortalArmador";

type Embarcacao = { id: string; nome?: string; ativo?: boolean };
type Acesso = {
  uid: string;
  nome: string;
  email: string;
  papel: string;
  ativo: boolean;
  embarcacaoIds: string[];
  permissoes?: Record<string, boolean>;
};

const PAPEIS = [
  { id: "proprietario", nome: "Proprietário" },
  { id: "gestor", nome: "Gestor" },
  { id: "financeiro", nome: "Financeiro" },
  { id: "atendimento", nome: "Atendimento" },
  { id: "consulta", nome: "Somente consulta" },
];

const PERMISSOES = [
  { id: "dashboard", nome: "Visão geral" },
  { id: "frota", nome: "Embarcações" },
  { id: "programacao", nome: "Programação e tarifas" },
  { id: "vendas", nome: "Vendas" },
];

async function chamarFuncao(corpo: Record<string, unknown>) {
  const usuario = getAuth().currentUser;
  if (!usuario) throw new Error("Faça login novamente.");
  const token = await usuario.getIdToken();
  const resposta = await fetch(URL_GERENCIAR_ACESSO, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  });
  const dados = await resposta.json();
  if (!resposta.ok) throw new Error(dados.erro || "Não foi possível concluir a operação.");
  return dados;
}

export default function GestaoPortalArmadores() {
  const [barcos, setBarcos] = useState<Embarcacao[]>([]);
  const [acessos, setAcessos] = useState<Acesso[]>([]);
  const [uid, setUid] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState("proprietario");
  const [embarcacaoIds, setEmbarcacaoIds] = useState<string[]>([]);
  const [permissoes, setPermissoes] = useState<Record<string, boolean>>({
    dashboard: true,
    frota: true,
    programacao: true,
    vendas: true,
  });
  const [processando, setProcessando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [linkAcesso, setLinkAcesso] = useState("");

  useEffect(() => {
    const unsubBarcos = onSnapshot(collection(db, "embarcacoes"), (snapshot) =>
      setBarcos(
        snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }) as Embarcacao)
          .filter(
            (barco) =>
              !["CF_CONECT", "CADE_MEU_BARCO"].includes(
                String(barco.id).toUpperCase(),
              ),
          )
          .sort((a, b) => String(a.nome || a.id).localeCompare(String(b.nome || b.id))),
      ),
    );
    const unsubAcessos = onSnapshot(collection(db, "acessos_armadores"), (snapshot) =>
      setAcessos(
        snapshot.docs
          .map((item) => ({ uid: item.id, ...item.data() }) as Acesso)
          .sort((a, b) => a.nome.localeCompare(b.nome)),
      ),
    );
    return () => { unsubBarcos(); unsubAcessos(); };
  }, []);

  const selecionadas = useMemo(
    () => barcos.filter((barco) => embarcacaoIds.includes(barco.id)),
    [barcos, embarcacaoIds],
  );

  function limpar() {
    setUid(""); setNome(""); setEmail(""); setPapel("proprietario");
    setEmbarcacaoIds([]);
    setPermissoes({ dashboard: true, frota: true, programacao: true, vendas: true });
    setMensagem(""); setErro(""); setLinkAcesso("");
  }

  function editar(acesso: Acesso) {
    setUid(acesso.uid); setNome(acesso.nome); setEmail(acesso.email);
    setPapel(acesso.papel || "proprietario");
    setEmbarcacaoIds(acesso.embarcacaoIds || []);
    setPermissoes({ dashboard: true, frota: true, programacao: true, vendas: true, ...(acesso.permissoes || {}) });
    setMensagem(""); setErro(""); setLinkAcesso("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault(); setProcessando(true); setErro(""); setMensagem(""); setLinkAcesso("");
    try {
      const resultado = await chamarFuncao({
        acao: uid ? "atualizar" : "criar", uid, nome, email, papel,
        embarcacaoIds, permissoes, ativo: true,
      });
      setMensagem(uid ? "Acesso atualizado com segurança." : "Acesso criado com segurança.");
      if (resultado.linkDefinirSenha) setLinkAcesso(resultado.linkDefinirSenha);
      if (!uid) { setNome(""); setEmail(""); setEmbarcacaoIds([]); }
    } catch (falha: any) { setErro(falha.message || "Não foi possível salvar."); }
    finally { setProcessando(false); }
  }

  async function alternar(acesso: Acesso) {
    setProcessando(true); setErro(""); setMensagem("");
    try {
      await chamarFuncao({ acao: acesso.ativo ? "desativar" : "ativar", uid: acesso.uid });
      setMensagem(acesso.ativo ? "Acesso revogado." : "Acesso reativado.");
    } catch (falha: any) { setErro(falha.message); }
    finally { setProcessando(false); }
  }

  async function redefinir(acesso: Acesso) {
    setProcessando(true); setErro(""); setMensagem(""); setLinkAcesso("");
    try {
      const resultado = await chamarFuncao({ acao: "redefinir_senha", email: acesso.email });
      setLinkAcesso(resultado.linkDefinirSenha);
      setMensagem("Novo link de senha gerado. Copie e envie somente ao responsável.");
    } catch (falha: any) { setErro(falha.message); }
    finally { setProcessando(false); }
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <section className="rounded-3xl border border-sky-300/20 bg-[#142557] p-5 text-white shadow-xl">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-sky-300">Portal do Armador</p>
        <h1 className="mt-2 text-2xl font-black">Acessos por embarcação</h1>
        <p className="mt-2 max-w-3xl text-xs leading-6 text-sky-100/60">
          O e-mail identifica o convite, mas a autorização utiliza o UID do Firebase e as embarcações selecionadas. O login do portal não precisa ser o mesmo e-mail da conta Mercado Pago.
        </p>
      </section>

      <form onSubmit={salvar} className="rounded-3xl border border-sky-300/15 bg-[#101f49] p-5 text-white">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-widest text-sky-300">{uid ? "Editando acesso" : "Novo acesso"}</p><h2 className="mt-1 text-xl font-black">Responsável da embarcação</h2></div>{uid && <button type="button" onClick={limpar} className="rounded-xl border border-white/15 px-4 py-2 text-xs font-black">Cancelar edição</button>}</div>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <label className="text-xs font-bold text-sky-100/70">Nome completo<input value={nome} onChange={(e) => setNome(e.target.value)} required className="mt-2 w-full rounded-xl border border-sky-300/20 bg-[#071634] px-4 py-3 text-white outline-none" /></label>
          <label className="text-xs font-bold text-sky-100/70">E-mail de acesso<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-2 w-full rounded-xl border border-sky-300/20 bg-[#071634] px-4 py-3 text-white outline-none" /></label>
          <label className="text-xs font-bold text-sky-100/70">Função<select value={papel} onChange={(e) => setPapel(e.target.value)} className="mt-2 w-full rounded-xl border border-sky-300/20 bg-[#071634] px-4 py-3 text-white outline-none">{PAPEIS.map((item) => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
        </div>

        <div className="mt-5"><p className="text-xs font-black text-white">Embarcações autorizadas</p><div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{barcos.map((barco) => <label key={barco.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#071634] p-3 text-xs font-bold"><input type="checkbox" checked={embarcacaoIds.includes(barco.id)} onChange={(e) => setEmbarcacaoIds((atuais) => e.target.checked ? [...atuais, barco.id] : atuais.filter((id) => id !== barco.id))} /> <span>{barco.nome || barco.id}<small className="block text-[9px] text-sky-100/40">{barco.id}</small></span></label>)}</div></div>
        <div className="mt-5"><p className="text-xs font-black text-white">Áreas visíveis</p><div className="mt-3 flex flex-wrap gap-2">{PERMISSOES.map((item) => <label key={item.id} className="flex items-center gap-2 rounded-full border border-white/10 bg-[#071634] px-3 py-2 text-[10px] font-bold"><input type="checkbox" checked={permissoes[item.id] !== false} onChange={(e) => setPermissoes((atual) => ({ ...atual, [item.id]: e.target.checked }))} /> {item.nome}</label>)}</div></div>
        {selecionadas.length > 0 && <p className="mt-4 text-[10px] text-sky-100/50">Selecionadas: {selecionadas.map((item) => item.nome || item.id).join(", ")}</p>}
        {erro && <div className="mt-4 rounded-xl border border-red-300/20 bg-red-400/10 p-3 text-xs text-red-100">{erro}</div>}
        {mensagem && <div className="mt-4 rounded-xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-xs text-emerald-100">{mensagem}</div>}
        {linkAcesso && <div className="mt-4 rounded-xl border border-amber-300/20 bg-amber-400/10 p-3"><p className="text-[10px] font-black uppercase text-amber-200">Link para criar/redefinir senha</p><div className="mt-2 flex gap-2"><input readOnly value={linkAcesso} className="min-w-0 flex-1 rounded-lg bg-[#071634] px-3 py-2 text-[10px]" /><button type="button" onClick={() => navigator.clipboard.writeText(linkAcesso)} className="rounded-lg bg-amber-300 px-3 py-2 text-[10px] font-black text-[#241b00]">Copiar</button></div></div>}
        <button disabled={processando} className="mt-5 rounded-xl bg-sky-500 px-5 py-3 text-xs font-black text-white disabled:opacity-50">{processando ? "Processando..." : uid ? "Atualizar acesso" : "Criar acesso"}</button>
      </form>

      <section className="rounded-3xl border border-sky-300/15 bg-[#101f49] p-5 text-white">
        <p className="text-[10px] font-black uppercase tracking-widest text-sky-300">Acessos cadastrados</p>
        <div className="mt-4 space-y-3">{acessos.map((acesso) => <article key={acesso.uid} className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-[#071634] p-4 lg:flex-row lg:items-center"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong>{acesso.nome}</strong><span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${acesso.ativo ? "bg-emerald-400/15 text-emerald-300" : "bg-red-400/15 text-red-300"}`}>{acesso.ativo ? "Ativo" : "Desativado"}</span></div><p className="mt-1 text-xs text-sky-100/55">{acesso.email} · {acesso.papel}</p><p className="mt-2 text-[10px] text-sky-100/40">{(acesso.embarcacaoIds || []).join(", ") || "Sem embarcação"}</p></div><div className="flex flex-wrap gap-2"><button onClick={() => editar(acesso)} className="rounded-lg border border-sky-300/20 px-3 py-2 text-[10px] font-black">Editar</button><button onClick={() => redefinir(acesso)} disabled={processando} className="rounded-lg border border-amber-300/20 px-3 py-2 text-[10px] font-black text-amber-200">Nova senha</button><button onClick={() => alternar(acesso)} disabled={processando} className={`rounded-lg border px-3 py-2 text-[10px] font-black ${acesso.ativo ? "border-red-300/20 text-red-200" : "border-emerald-300/20 text-emerald-200"}`}>{acesso.ativo ? "Revogar" : "Reativar"}</button></div></article>)}</div>
      </section>
    </div>
  );
}
