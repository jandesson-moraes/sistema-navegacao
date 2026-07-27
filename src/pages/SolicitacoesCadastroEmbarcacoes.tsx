import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {db} from "../config/firebase";

type Solicitacao = {
  id: string;
  codigoProvisorio?: string;
  nomeEmbarcacao?: string;
  tipoEmbarcacao?: string;
  cidade?: string;
  portoSaida?: string;
  cnpj?: string;
  nomeSolicitante?: string;
  telefone?: string;
  vinculo?: string;
  planoInteresse?: string;
  autorizaMelhoria?: boolean;
  fotoOriginalUrl?: string;
  observacoes?: string;
  status?: string;
  telefoneValidado?: boolean;
};

const pendentes = ["aguardando_whatsapp", "em_analise", "correcao_solicitada"];

export default function SolicitacoesCadastroEmbarcacoes() {
  const [itens, setItens] = useState<Solicitacao[]>([]);
  const [selecionada, setSelecionada] = useState<Solicitacao | null>(null);
  const [filtro, setFiltro] = useState("pendentes");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "solicitacoes_cadastro_embarcacoes"), orderBy("criadoEm", "desc")),
      (snapshot) => setItens(snapshot.docs.map((item) => ({id: item.id, ...item.data()}))),
    );
  }, []);

  const visiveis = useMemo(
    () => itens.filter((item) => filtro === "todos" ||
      (filtro === "pendentes" ? pendentes.includes(item.status || "") : item.status === filtro)),
    [filtro, itens],
  );

  async function alterarStatus(status: string, extras: Record<string, unknown> = {}) {
    if (!selecionada) return;
    setOcupado(true);
    try {
      await updateDoc(doc(db, "solicitacoes_cadastro_embarcacoes", selecionada.id), {
        status, atualizadoEm: serverTimestamp(), ...extras,
      });
      setSelecionada((atual) => atual ? {...atual, status, ...extras} : atual);
    } finally {
      setOcupado(false);
    }
  }

  async function aprovar() {
    if (!selecionada) return;
    if (!selecionada.telefoneValidado) {
      window.alert("Confirme primeiro o WhatsApp do solicitante.");
      return;
    }
    setOcupado(true);
    try {
      const barco = await addDoc(collection(db, "embarcacoes"), {
        nome: selecionada.nomeEmbarcacao || "",
        tipo: selecionada.tipoEmbarcacao || "",
        cidade: selecionada.cidade || "",
        portoSaida: selecionada.portoSaida || "",
        cnpj: selecionada.cnpj || "",
        codigoEmbarcacao: selecionada.codigoProvisorio || "",
        foto: selecionada.fotoOriginalUrl || "",
        fotos: selecionada.fotoOriginalUrl ? [selecionada.fotoOriginalUrl] : [],
        planoId: "basico",
        planoStatus: "ativo",
        statusCadastro: "aprovado",
        statusPublicacao: "publicado",
        contatoPrincipal: selecionada.telefone || "",
        origemCadastro: "cadastro_publico",
        solicitacaoCadastroId: selecionada.id,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });
      await alterarStatus("aprovado", {embarcacaoId: barco.id, aprovadoEm: serverTimestamp()});
    } finally {
      setOcupado(false);
    }
  }

  const chip = (status?: string) => ({
    aguardando_whatsapp: "Aguardando WhatsApp",
    em_analise: "Em análise",
    correcao_solicitada: "Correção solicitada",
    aprovado: "Aprovado",
    rejeitado: "Rejeitado",
    duplicado: "Duplicado",
  }[status || ""] || status || "Novo");

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 sm:p-7">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap gap-2">
          {["pendentes", "aprovado", "rejeitado", "duplicado", "todos"].map((valor) => (
            <button key={valor} onClick={() => setFiltro(valor)}
              className={`rounded-full px-4 py-2 text-sm font-black ${filtro === valor ? "bg-[#0f2240] text-white" : "bg-white text-slate-600"}`}>
              {valor === "pendentes" ? `Pendentes (${itens.filter((i) => pendentes.includes(i.status || "")).length})` : valor}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="space-y-3">
            {visiveis.map((item) => (
              <button key={item.id} onClick={() => setSelecionada(item)}
                className="w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-sky-300">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-sky-700">{item.codigoProvisorio}</p>
                    <h2 className="mt-1 text-xl font-black text-[#0f2240]">{item.nomeEmbarcacao}</h2>
                    <p className="mt-1 text-sm text-slate-500">{item.cidade || "Cidade não informada"} · {item.nomeSolicitante}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">{chip(item.status)}</span>
                </div>
              </button>
            ))}
            {!visiveis.length && <div className="rounded-3xl bg-white p-8 text-center font-bold text-slate-500">Nenhum cadastro neste filtro.</div>}
          </section>

          <aside className="lg:sticky lg:top-0 lg:self-start">
            {selecionada ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg">
                {selecionada.fotoOriginalUrl && <img src={selecionada.fotoOriginalUrl} alt="" className="h-52 w-full rounded-2xl object-cover" />}
                <p className="mt-5 text-xs font-black uppercase tracking-widest text-sky-700">{selecionada.codigoProvisorio}</p>
                <h2 className="mt-1 text-2xl font-black text-[#0f2240]">{selecionada.nomeEmbarcacao}</h2>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="font-bold text-slate-400">Solicitante</dt><dd className="font-bold">{selecionada.nomeSolicitante}</dd></div>
                  <div><dt className="font-bold text-slate-400">Vínculo</dt><dd className="font-bold">{selecionada.vinculo}</dd></div>
                  <div><dt className="font-bold text-slate-400">WhatsApp</dt><dd className="font-bold">{selecionada.telefone}</dd></div>
                  <div><dt className="font-bold text-slate-400">Plano desejado</dt><dd className="font-bold">{selecionada.planoInteresse}</dd></div>
                  <div><dt className="font-bold text-slate-400">Porto</dt><dd className="font-bold">{selecionada.portoSaida || "—"}</dd></div>
                  <div><dt className="font-bold text-slate-400">CNPJ</dt><dd className="font-bold">{selecionada.cnpj || "—"}</dd></div>
                </dl>
                {selecionada.observacoes && <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">{selecionada.observacoes}</p>}
                <div className="mt-5 grid gap-2">
                  {!selecionada.telefoneValidado && (
                    <button disabled={ocupado} onClick={() => alterarStatus("em_analise", {telefoneValidado: true, telefoneValidadoEm: serverTimestamp()})}
                      className="min-h-12 rounded-2xl bg-emerald-500 font-black text-white">Confirmar WhatsApp</button>
                  )}
                  <button disabled={ocupado || selecionada.status === "aprovado"} onClick={aprovar}
                    className="min-h-12 rounded-2xl bg-sky-600 font-black text-white disabled:opacity-40">Aprovar no plano Básico</button>
                  <div className="grid grid-cols-3 gap-2">
                    <button disabled={ocupado} onClick={() => alterarStatus("correcao_solicitada")} className="rounded-xl bg-amber-100 p-3 text-xs font-black text-amber-900">Pedir correção</button>
                    <button disabled={ocupado} onClick={() => alterarStatus("duplicado")} className="rounded-xl bg-violet-100 p-3 text-xs font-black text-violet-900">Duplicado</button>
                    <button disabled={ocupado} onClick={() => alterarStatus("rejeitado")} className="rounded-xl bg-red-100 p-3 text-xs font-black text-red-900">Rejeitar</button>
                  </div>
                </div>
              </div>
            ) : <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center font-bold text-slate-500">Selecione um cadastro para analisar.</div>}
          </aside>
        </div>
      </div>
    </div>
  );
}
