import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {db} from "../config/firebase";
import type {RotaCadastro} from "../components/RotasCadastroPublico";

type Solicitacao = {
  id: string;
  codigoProvisorio?: string;
  nomeEmbarcacao?: string;
  tipoEmbarcacao?: string;
  cidade?: string;
  portoSaida?: string;
  origemCidade?: string;
  destinoCidade?: string;
  descricao?: string;
  escalasTexto?: string;
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
  rotas?: RotaCadastro[];
};

const pendentes = ["aguardando_whatsapp", "em_analise", "correcao_solicitada"];

function separarEscalas(valor?: string) {
  return String(valor || "")
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatarCnpj(valor?: string) {
  return String(valor || "").replace(/\D/g, "").slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function normalizarIdEmbarcacao(nome?: string) {
  const base = String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
  return `CMD_${base || "EMBARCACAO"}`;
}

function CampoEdicao({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value?: string;
  onChange: (valor: string) => void;
  multiline?: boolean;
}) {
  const classe =
    "mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-800 outline-none focus:border-sky-400";
  return (
    <label className="block text-xs font-black uppercase tracking-wide text-slate-500">
      {label}
      {multiline ? (
        <textarea rows={4} value={value || ""} onChange={(e) => onChange(e.target.value)} className={classe} />
      ) : (
        <input value={value || ""} onChange={(e) => onChange(e.target.value)} className={classe} />
      )}
    </label>
  );
}

export default function SolicitacoesCadastroEmbarcacoes() {
  const [itens, setItens] = useState<Solicitacao[]>([]);
  const [selecionada, setSelecionada] = useState<Solicitacao | null>(null);
  const [rascunho, setRascunho] = useState<Solicitacao | null>(null);
  const [filtro, setFiltro] = useState("pendentes");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => onSnapshot(
    query(collection(db, "solicitacoes_cadastro_embarcacoes"), orderBy("criadoEm", "desc")),
    (snapshot) => setItens(snapshot.docs.map((item) => ({id: item.id, ...item.data()}))),
  ), []);

  const visiveis = useMemo(
    () => itens.filter((item) => filtro === "todos" ||
      (filtro === "pendentes" ? pendentes.includes(item.status || "") : item.status === filtro)),
    [filtro, itens],
  );

  function selecionar(item: Solicitacao) {
    setSelecionada(item);
    setRascunho({...item});
  }

  function editar(campo: keyof Solicitacao, valor: string) {
    setRascunho((atual) => atual ? {...atual, [campo]: valor} : atual);
  }

  async function alterarStatus(status: string, extras: Record<string, unknown> = {}) {
    if (!selecionada) return;
    setOcupado(true);
    try {
      await updateDoc(doc(db, "solicitacoes_cadastro_embarcacoes", selecionada.id), {
        status, atualizadoEm: serverTimestamp(), ...extras,
      });
      setSelecionada((atual) => atual ? {...atual, status, ...extras} : atual);
      setRascunho((atual) => atual ? {...atual, status, ...extras} : atual);
    } finally {
      setOcupado(false);
    }
  }

  async function salvarRevisao() {
    if (!selecionada || !rascunho) return;
    if (!selecionada.autorizaMelhoria) {
      const continuar = window.confirm(
        "O solicitante não autorizou melhorias. Deseja salvar somente uma correção necessária?",
      );
      if (!continuar) return;
    }
    setOcupado(true);
    try {
      const campos = {
        nomeEmbarcacao: rascunho.nomeEmbarcacao || "",
        tipoEmbarcacao: rascunho.tipoEmbarcacao || "",
        cidade: rascunho.cidade || "",
        portoSaida: rascunho.portoSaida || "",
        origemCidade: rascunho.origemCidade || "",
        destinoCidade: rascunho.destinoCidade || "",
        descricao: rascunho.descricao || "",
        escalasTexto: rascunho.escalasTexto || "",
        cnpj: rascunho.cnpj || "",
        telefone: rascunho.telefone || "",
        fotoOriginalUrl: rascunho.fotoOriginalUrl || "",
        revisadoPelaEquipe: true,
        atualizadoEm: serverTimestamp(),
      };
      await updateDoc(doc(db, "solicitacoes_cadastro_embarcacoes", selecionada.id), campos);
      setSelecionada((atual) => atual ? {...atual, ...campos} : atual);
      window.alert("Revisão salva. Agora você pode aprovar.");
    } finally {
      setOcupado(false);
    }
  }

  async function aprovar() {
    if (!selecionada || !rascunho) return;
    if (!selecionada.telefoneValidado) {
      window.alert("Confirme primeiro o WhatsApp do solicitante.");
      return;
    }
    if (!rascunho.nomeEmbarcacao?.trim()) {
      window.alert("Informe o nome da embarcação.");
      return;
    }
    setOcupado(true);
    try {
      await salvarRevisao();
      const foto = rascunho.fotoOriginalUrl || "";
      const escalas = separarEscalas(rascunho.escalasTexto);
      const idBase = normalizarIdEmbarcacao(rascunho.nomeEmbarcacao);
      let idEmbarcacao = idBase;
      let sufixo = 2;
      while ((await getDoc(doc(db, "embarcacoes", idEmbarcacao))).exists()) {
        idEmbarcacao = `${idBase}_${sufixo}`;
        sufixo += 1;
      }
      const barco = doc(db, "embarcacoes", idEmbarcacao);
      await setDoc(barco, {
        id: idEmbarcacao,
        nome: rascunho.nomeEmbarcacao.trim(),
        tipo: rascunho.tipoEmbarcacao || "",
        tipoBarco: rascunho.tipoEmbarcacao || "",
        cidade: rascunho.cidade || rascunho.origemCidade || "",
        portoSaida: rascunho.portoSaida || "",
        descricao: rascunho.descricao || "",
        origem: rascunho.origemCidade || "",
        origemCidade: rascunho.origemCidade || "",
        destino: rascunho.destinoCidade || "",
        destinoCidade: rascunho.destinoCidade || "",
        escalasBasicas: escalas,
        cnpj: rascunho.cnpj || "",
        codigoEmbarcacao: rascunho.codigoProvisorio || "",
        foto,
        fotoUrl: foto,
        imagem: foto,
        fotos: foto ? [foto] : [],
        planoId: "basico",
        planoStatus: "ativo",
        planoEfetivoId: "basico",
        statusCadastro: "aprovado",
        statusPublicacao: "publicado",
        status: "ativo",
        ativo: true,
        visivelNoApp: true,
        nomeNaRede: `CMB_${idEmbarcacao}`,
        rastreadorAtivo: false,
        contatoPrincipal: rascunho.telefone || "",
        origemCadastro: "cadastro_publico",
        solicitacaoCadastroId: selecionada.id,
        criadoEm: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });

      const rotasCompletas = rascunho.rotas?.length ? rascunho.rotas : [{
        sentido: "ida" as const,
        origemUf: "",
        origemCidade: rascunho.origemCidade || rascunho.cidade || "",
        portoOrigem: rascunho.portoSaida || "",
        destinoUf: "",
        destinoCidade: rascunho.destinoCidade || "",
        portoDestino: "",
        diasSemana: [],
        horarioSaida: "",
        duracaoHoras: 0,
        escalas: escalas.map((cidade) => ({
          cidade, porto: cidade, diaRelativo: 0, horarioChegada: "", horarioSaida: "",
        })),
      }];

      for (let indiceRota = 0; indiceRota < rotasCompletas.length; indiceRota += 1) {
        const rota = rotasCompletas[indiceRota];
        const intermediarios = rota.escalas.map((escala, indice) => ({
          id: `escala_${indice + 1}`,
          tipo: "escala",
          ordem: indice + 1,
          cidade: escala.cidade,
          portoNome: escala.porto,
          diaRelativo: escala.diaRelativo,
          horarioChegada: escala.horarioChegada,
          horarioSaida: escala.horarioSaida,
        }));
        const itinerario = [
          {
            id: "origem", tipo: "origem", ordem: 0,
            cidade: rota.origemCidade, portoNome: rota.portoOrigem,
            diaRelativo: 0, horarioSaida: rota.horarioSaida,
          },
          ...intermediarios,
          {
            id: "destino", tipo: "destino", ordem: intermediarios.length + 1,
            cidade: rota.destinoCidade, portoNome: rota.portoDestino,
            diaRelativo: Math.max(0, ...rota.escalas.map((item) => item.diaRelativo)),
            horarioChegada: "", horarioSaida: "",
          },
        ].filter((ponto) => ponto.cidade || ponto.portoNome);
        if (!itinerario.length) continue;
        const idProgramacao = `${barco.id}_cadastro_${rota.sentido}_${indiceRota + 1}`;
        await setDoc(doc(db, "programacoes_viagem", idProgramacao), {
          id: idProgramacao,
          barcoId: barco.id,
          barcoNome: rascunho.nomeEmbarcacao,
          sentido: rota.sentido,
          origem: rota.origemCidade,
          destino: rota.destinoCidade,
          origemCidade: rota.origemCidade,
          destinoCidade: rota.destinoCidade,
          origemPortoNome: rota.portoOrigem,
          destinoPortoNome: rota.portoDestino,
          portoOrigem: rota.portoOrigem,
          portoDestino: rota.portoDestino,
          diasSemana: rota.diasSemana,
          horarioSaida: rota.horarioSaida,
          duracaoPrevistaMinutos: rota.duracaoNaoInformada ? null : rota.duracaoHoras * 60,
          duracaoInformada: rota.duracaoNaoInformada !== true,
          timezone: "America/Manaus",
          itinerario,
          escalas: itinerario,
          ativo: true,
          conteudoCompletoAprovado: true,
          visibilidadeControladaPeloPlano: true,
          criadoEm: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
        });
      }
      await alterarStatus("aprovado", {embarcacaoId: barco.id, aprovadoEm: serverTimestamp()});
      const telefone = String(rascunho.telefone || "").replace(/\D/g, "");
      if (telefone) {
        const numero = telefone.startsWith("55") ? telefone : `55${telefone}`;
        const mensagem = encodeURIComponent(
          `Olá, ${rascunho.nomeSolicitante || ""}! A embarcação ${rascunho.nomeEmbarcacao} foi aprovada e já está cadastrada no aplicativo Cadê Meu Barco. Código: ${rascunho.codigoProvisorio || ""}.`,
        );
        if (window.confirm("Embarcação aprovada. Deseja avisar o solicitante pelo WhatsApp agora?")) {
          window.open(`https://wa.me/${numero}?text=${mensagem}`, "_blank", "noopener,noreferrer");
        }
      }
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

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_460px]">
          <section className="space-y-3">
            {visiveis.map((item) => (
              <button key={item.id} onClick={() => selecionar(item)}
                className="w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-sky-300">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-sky-700">{item.codigoProvisorio}</p>
                    <h2 className="mt-1 text-xl font-black text-[#0f2240]">{item.nomeEmbarcacao}</h2>
                    <p className="mt-1 text-sm text-slate-500">{item.cidade || item.origemCidade || "Cidade não informada"} · {item.nomeSolicitante}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">{chip(item.status)}</span>
                </div>
              </button>
            ))}
            {!visiveis.length && <div className="rounded-3xl bg-white p-8 text-center font-bold text-slate-500">Nenhum cadastro neste filtro.</div>}
          </section>

          <aside className="lg:sticky lg:top-0 lg:self-start">
            {selecionada && rascunho ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-lg">
                {rascunho.fotoOriginalUrl && <img src={rascunho.fotoOriginalUrl} alt="" className="h-52 w-full rounded-2xl object-cover" />}
                {rascunho.fotoOriginalUrl && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <a href={rascunho.fotoOriginalUrl} target="_blank" rel="noreferrer"
                      className="rounded-xl bg-slate-100 p-2 text-center text-xs font-black text-slate-700">Ver original</a>
                    <a href={rascunho.fotoOriginalUrl} download
                      className="rounded-xl bg-sky-100 p-2 text-center text-xs font-black text-sky-800">Baixar imagem</a>
                  </div>
                )}
                <p className="mt-5 text-xs font-black uppercase tracking-widest text-sky-700">{selecionada.codigoProvisorio}</p>
                <h2 className="mt-1 text-2xl font-black text-[#0f2240]">Revisar antes de publicar</h2>
                <div className="mt-3 rounded-2xl bg-[#0f2240] p-3 text-white">
                  <p className="text-[10px] font-black uppercase tracking-widest text-sky-300">ID que será criado</p>
                  <p className="mt-1 break-all font-mono text-sm font-black">{normalizarIdEmbarcacao(rascunho.nomeEmbarcacao)}</p>
                </div>
                <p className={`mt-3 rounded-2xl p-3 text-sm font-bold ${selecionada.autorizaMelhoria ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
                  {selecionada.autorizaMelhoria ? "✓ Autorizado melhorar foto, texto e organização dos dados." : "Melhorias não autorizadas. Peça correção para mudanças editoriais."}
                </p>

                <div className="mt-4 grid gap-3">
                  <CampoEdicao label="Nome da embarcação" value={rascunho.nomeEmbarcacao} onChange={(v) => editar("nomeEmbarcacao", v)} />
                  <div className="grid grid-cols-2 gap-3">
                    <CampoEdicao label="Tipo" value={rascunho.tipoEmbarcacao} onChange={(v) => editar("tipoEmbarcacao", v)} />
                    <CampoEdicao label="CNPJ" value={formatarCnpj(rascunho.cnpj)} onChange={(v) => editar("cnpj", v.replace(/\D/g, "").slice(0, 14))} />
                  </div>
                  <CampoEdicao label="Porto de saída" value={rascunho.portoSaida} onChange={(v) => editar("portoSaida", v)} />
                  <div className="grid grid-cols-2 gap-3">
                    <CampoEdicao label="Origem" value={rascunho.origemCidade || rascunho.cidade} onChange={(v) => editar("origemCidade", v)} />
                    <CampoEdicao label="Destino" value={rascunho.destinoCidade} onChange={(v) => editar("destinoCidade", v)} />
                  </div>
                  <CampoEdicao label="Descrição" value={rascunho.descricao} multiline onChange={(v) => editar("descricao", v)} />
                  <CampoEdicao label="Escalas sem horários" value={rascunho.escalasTexto} multiline onChange={(v) => editar("escalasTexto", v)} />
                  <CampoEdicao label="WhatsApp" value={rascunho.telefone} onChange={(v) => editar("telefone", v)} />
                  <CampoEdicao label="URL da foto aprovada" value={rascunho.fotoOriginalUrl} onChange={(v) => editar("fotoOriginalUrl", v)} />
                </div>

                {!!rascunho.rotas?.length && (
                  <div className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                    <h3 className="font-black text-[#0f2240]">Rotas completas para aprovação</h3>
                    <div className="mt-3 space-y-3">
                      {rascunho.rotas.map((rota, indice) => (
                        <div key={indice} className="rounded-xl bg-white p-3 text-sm">
                          <p className="font-black uppercase text-sky-700">{rota.sentido}</p>
                          <p className="mt-1 font-bold">{rota.origemCidade || "Origem"} → {rota.destinoCidade || "Destino"}</p>
                          <p className="text-slate-500">{rota.portoOrigem || "Porto não informado"} · saída {rota.horarioSaida || "sem horário"}</p>
                          <p className="mt-1 text-slate-600">{rota.escalas.length} escala(s) · {rota.diasSemana.length} dia(s) de saída</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-xs font-semibold text-sky-900">
                      Os horários serão armazenados, mas o aplicativo os ocultará enquanto o plano for Básico.
                    </p>
                  </div>
                )}

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="font-bold text-slate-400">Solicitante</dt><dd className="font-bold">{selecionada.nomeSolicitante}</dd></div>
                  <div><dt className="font-bold text-slate-400">Vínculo</dt><dd className="font-bold">{selecionada.vinculo}</dd></div>
                  <div><dt className="font-bold text-slate-400">Plano desejado</dt><dd className="font-bold">{selecionada.planoInteresse}</dd></div>
                  <div><dt className="font-bold text-slate-400">Status</dt><dd className="font-bold">{chip(selecionada.status)}</dd></div>
                </dl>

                {selecionada.observacoes && <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm">{selecionada.observacoes}</p>}
                <div className="mt-5 grid gap-2">
                  <button disabled={ocupado} onClick={salvarRevisao}
                    className="min-h-12 rounded-2xl border border-sky-600 bg-white font-black text-sky-700">Salvar revisão</button>
                  {!selecionada.telefoneValidado && (
                    <button disabled={ocupado} onClick={() => alterarStatus("em_analise", {telefoneValidado: true, telefoneValidadoEm: serverTimestamp()})}
                      className="min-h-12 rounded-2xl bg-emerald-500 font-black text-white">Confirmar WhatsApp</button>
                  )}
                  <button disabled={ocupado || selecionada.status === "aprovado"} onClick={aprovar}
                    className="min-h-12 rounded-2xl bg-sky-600 font-black text-white disabled:opacity-40">Salvar e aprovar no plano Básico</button>
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
