import React, {useEffect, useMemo, useState} from "react";
import {collection, onSnapshot} from "firebase/firestore";
import {db} from "../config/firebase";

type Uf = {id: number; sigla: string; nome: string};
type Municipio = {id: number; nome: string};
type Opcao = {valor: string; rotulo: string; busca?: string};

export type EscalaCadastro = {
  uf?: string;
  cidade: string;
  porto: string;
  diasPassagem?: number[];
  diaRelativo: number;
  horarioChegada: string;
  horarioSaida: string;
};

export type RotaCadastro = {
  sentido: "ida" | "volta";
  origemUf: string;
  origemCidade: string;
  portoOrigem: string;
  destinoUf: string;
  destinoCidade: string;
  portoDestino: string;
  diasSemana: number[];
  horarioSaida: string;
  destinoDiaRelativo?: number;
  destinoHorarioChegada?: string;
  duracaoHoras: number;
  duracaoNaoInformada?: boolean;
  itinerarioPersonalizado?: boolean;
  escalas: EscalaCadastro[];
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const NOMES_DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const UFS: Uf[] = [
  ["AC", "Acre"], ["AL", "Alagoas"], ["AP", "Amapá"], ["AM", "Amazonas"],
  ["BA", "Bahia"], ["CE", "Ceará"], ["DF", "Distrito Federal"], ["ES", "Espírito Santo"],
  ["GO", "Goiás"], ["MA", "Maranhão"], ["MT", "Mato Grosso"], ["MS", "Mato Grosso do Sul"],
  ["MG", "Minas Gerais"], ["PA", "Pará"], ["PB", "Paraíba"], ["PR", "Paraná"],
  ["PE", "Pernambuco"], ["PI", "Piauí"], ["RJ", "Rio de Janeiro"],
  ["RN", "Rio Grande do Norte"], ["RS", "Rio Grande do Sul"], ["RO", "Rondônia"],
  ["RR", "Roraima"], ["SC", "Santa Catarina"], ["SP", "São Paulo"],
  ["SE", "Sergipe"], ["TO", "Tocantins"],
].map(([sigla, nome], indice) => ({id: indice + 1, sigla, nome}));

const ROTA_VAZIA: RotaCadastro = {
  sentido: "ida", origemUf: "", origemCidade: "", portoOrigem: "",
  destinoUf: "", destinoCidade: "", portoDestino: "", diasSemana: [],
  horarioSaida: "", destinoDiaRelativo: 0, destinoHorarioChegada: "",
  duracaoHoras: 0, duracaoNaoInformada: true, itinerarioPersonalizado: false, escalas: [],
};

function textoSeguro(valor: unknown) {
  return typeof valor === "string" || typeof valor === "number"
    ? String(valor)
    : "";
}

function numerosSeguros(valor: unknown) {
  if (!Array.isArray(valor)) return [];
  return valor
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 31);
}

function normalizarEscalas(valor: unknown): EscalaCadastro[] {
  if (!Array.isArray(valor)) return [];
  return valor.map((item) => {
    const escala =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      uf: textoSeguro(escala.uf).toUpperCase().slice(0, 2),
      cidade: textoSeguro(escala.cidade),
      porto: textoSeguro(escala.porto || escala.portoNome),
      diasPassagem: numerosSeguros(escala.diasPassagem).filter((dia) => dia <= 6),
      diaRelativo: Number(escala.diaRelativo) || 0,
      horarioChegada: textoSeguro(escala.horarioChegada),
      horarioSaida: textoSeguro(escala.horarioSaida),
    };
  });
}

function normalizarRotaSalva(
  valor: unknown,
  sentido: "ida" | "volta",
): RotaCadastro {
  const rota =
    valor && typeof valor === "object" ? (valor as Record<string, unknown>) : {};
  return {
    ...ROTA_VAZIA,
    sentido,
    origemUf: textoSeguro(rota.origemUf).toUpperCase().slice(0, 2),
    origemCidade: textoSeguro(rota.origemCidade || rota.origem),
    portoOrigem: textoSeguro(rota.portoOrigem || rota.origemPortoNome),
    destinoUf: textoSeguro(rota.destinoUf).toUpperCase().slice(0, 2),
    destinoCidade: textoSeguro(rota.destinoCidade || rota.destino),
    portoDestino: textoSeguro(rota.portoDestino || rota.destinoPortoNome),
    diasSemana: numerosSeguros(rota.diasSemana).filter((dia) => dia <= 6),
    horarioSaida: textoSeguro(rota.horarioSaida),
    destinoDiaRelativo: Number(rota.destinoDiaRelativo) || 0,
    destinoHorarioChegada: textoSeguro(rota.destinoHorarioChegada),
    duracaoHoras: Number(rota.duracaoHoras) || 0,
    duracaoNaoInformada: rota.duracaoNaoInformada !== false,
    itinerarioPersonalizado: rota.itinerarioPersonalizado === true,
    escalas: normalizarEscalas(rota.escalas),
  };
}

function normalizar(valor: unknown) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function formatarNomeLocal(valor: unknown) {
  return String(valor || "")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*-\s*([a-z]{2})$/i, (_, uf: string) => ` - ${uf.toUpperCase()}`);
}

function SeletorLista({
  titulo,
  valor,
  placeholder,
  opcoes,
  desabilitado = false,
  pesquisavel = true,
  onChange,
}: {
  titulo?: string;
  valor: string;
  placeholder: string;
  opcoes: Opcao[];
  desabilitado?: boolean;
  pesquisavel?: boolean;
  onChange: (valor: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const selecionada = opcoes.find((item) => item.valor === valor);
  const filtradas = opcoes.filter((item) =>
    normalizar(`${item.rotulo} ${item.busca || ""}`).includes(normalizar(busca)));
  return (
    <div>
      {titulo && <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-300">{titulo}</p>}
      <button type="button" disabled={desabilitado} onClick={() => setAberto(true)}
        className="flex min-h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-[#10253e] px-3 text-left text-sm font-bold text-white disabled:opacity-45">
        <span className={selecionada ? "" : "text-slate-400"}>{selecionada?.rotulo || placeholder}</span>
        <span className="text-sky-300">⌄</span>
      </button>
      {aberto && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 p-3 pt-[max(12px,env(safe-area-inset-top))]">
          <button type="button" aria-label="Fechar" onClick={() => setAberto(false)} className="absolute inset-0" />
          <div className="relative z-10 flex h-[min(680px,calc(100svh-24px))] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#071a2f] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 p-4">
              <strong>{titulo || "Selecione uma opção"}</strong>
              <button type="button" onClick={() => setAberto(false)} className="h-9 w-9 rounded-xl bg-white/10 text-xl">×</button>
            </div>
            {pesquisavel && (
              <div className="p-3">
                <input autoFocus value={busca} onChange={(e) => setBusca(e.target.value)}
                  placeholder="Digite para pesquisar"
                  className="min-h-11 w-full rounded-xl border border-sky-400/20 bg-white/[0.07] px-3 text-white outline-none" />
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              {filtradas.map((item) => (
                <button type="button" key={item.valor} onClick={() => {onChange(item.valor); setAberto(false); setBusca("");}}
                  className={`mb-1 min-h-11 w-full rounded-xl px-3 text-left text-sm font-bold ${item.valor === valor ? "bg-sky-500 text-white" : "bg-white/[0.05] text-slate-200"}`}>
                  {item.rotulo}
                </button>
              ))}
              {!filtradas.length && <p className="p-5 text-center text-sm text-slate-400">Nenhuma opção encontrada.</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SeletorMunicipio({
  titulo, uf, cidade, onUf, onCidade,
}: {
  titulo: string; uf: string; cidade: string;
  onUf: (valor: string) => void; onCidade: (valor: string) => void;
}) {
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [cadastroManual, setCadastroManual] = useState(false);
  const [localidadeManual, setLocalidadeManual] = useState("");
  useEffect(() => {
    if (!uf) {setMunicipios([]); return;}
    setCarregando(true); setErro(false);
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`)
      .then((resposta) => {
        if (!resposta.ok) throw new Error("IBGE indisponível");
        return resposta.json();
      })
      .then((dados) => setMunicipios(Array.isArray(dados) ? dados : []))
      .catch(() => {setMunicipios([]); setErro(true);})
      .finally(() => setCarregando(false));
  }, [tentativa, uf]);

  return (
    <div className="rounded-2xl bg-white/[0.035] p-3">
      <p className="mb-2 text-sm font-black text-slate-200">{titulo}</p>
      <div className="grid grid-cols-[100px_1fr] gap-2">
        <SeletorLista valor={uf} placeholder="UF" pesquisavel={false}
          opcoes={UFS.map((item) => ({valor: item.sigla, rotulo: item.sigla, busca: item.nome}))}
          onChange={onUf} />
        <SeletorLista valor={cidade}
          placeholder={carregando ? "Carregando..." : erro ? "Falha ao carregar" : "Município"}
          desabilitado={!uf || carregando || erro}
          opcoes={[
            ...(cidade && !municipios.some((item) => `${item.nome} - ${uf}` === cidade)
              ? [{valor: cidade, rotulo: cidade.replace(/\s-\s[A-Z]{2}$/, "")}]
              : []),
            ...municipios.map((item) => ({valor: `${item.nome} - ${uf}`, rotulo: item.nome})),
            {valor: "__nova_localidade__", rotulo: "+ Minha comunidade/localidade não está na lista"},
          ]}
          onChange={(valor) => {
            if (valor === "__nova_localidade__") {
              setCadastroManual(true);
              onCidade("");
              return;
            }
            setCadastroManual(false);
            onCidade(valor);
          }} />
      </div>
      {cadastroManual && (
        <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-3">
          <label className="text-xs font-black uppercase tracking-wide text-amber-200">
            Nome correto da comunidade ou localidade
            <input
              autoFocus
              value={localidadeManual}
              onChange={(e) => setLocalidadeManual(e.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-[#10253e] px-3 text-sm normal-case text-white outline-none"
              placeholder="Ex.: Comunidade São Francisco - Manaus"
            />
          </label>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            Use nome completo e acentuação. Se precisar indicar o município, use um traço:
            <strong className="text-slate-200"> Comunidade São Francisco - Manaus</strong>.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => {setCadastroManual(false); setLocalidadeManual("");}}
              className="min-h-10 rounded-xl bg-white/10 text-xs font-black text-slate-200">
              Cancelar
            </button>
            <button type="button" disabled={localidadeManual.trim().length < 3}
              onClick={() => {
                const local = formatarNomeLocal(localidadeManual);
                onCidade(`${local} - ${uf}`);
                setCadastroManual(false);
              }}
              className="min-h-10 rounded-xl bg-amber-400 text-xs font-black text-slate-950 disabled:opacity-40">
              Usar esta localidade
            </button>
          </div>
        </div>
      )}
      {erro && <button type="button" onClick={() => setTentativa((v) => v + 1)}
        className="mt-2 text-xs font-black text-amber-300">Tentar carregar novamente</button>}
    </div>
  );
}

function HorarioCompacto({
  titulo, valor, onChange,
}: {titulo: string; valor: string; onChange: (valor: string) => void}) {
  const [horaAtual = "", minutoAtual = ""] = valor.split(":");
  const horas = Array.from({length: 24}, (_, i) => String(i).padStart(2, "0"));
  const minutos = Array.from({length: 12}, (_, i) => String(i * 5).padStart(2, "0"));
  return (
    <div>
      <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-300">{titulo}</p>
      <div className="grid grid-cols-[1fr_16px_1fr] items-center gap-1">
        <SeletorLista valor={horaAtual} placeholder="Hora" pesquisavel={false}
          opcoes={horas.map((hora) => ({valor: hora, rotulo: hora}))}
          onChange={(hora) => onChange(`${hora}:${minutoAtual || "00"}`)} />
        <span className="text-center font-black">:</span>
        <SeletorLista valor={minutoAtual} placeholder="Min." pesquisavel={false}
          opcoes={minutos.map((minuto) => ({valor: minuto, rotulo: minuto}))}
          onChange={(minuto) => onChange(`${horaAtual || "00"}:${minuto}`)} />
      </div>
    </div>
  );
}

function SeletorPorto({
  titulo, valor, cidade, portos, onChange,
}: {titulo: string; valor: string; cidade: string; portos: Opcao[]; onChange: (valor: string) => void}) {
  const [novo, setNovo] = useState(false);
  const localSemUf = cidade.replace(/\s-\s[A-Z]{2}$/, "").trim();
  const nomeCidade = localSemUf.split(/\s-\s/).pop()?.trim() || localSemUf;
  const filtrados = portos.filter((item) =>
    Boolean(cidade) && normalizar(item.busca).includes(normalizar(nomeCidade)));
  const input = "mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#10253e] px-3 text-sm text-white outline-none";
  return (
    <div>
      <SeletorLista titulo={cidade ? `${titulo} · ${filtrados.length} ${filtrados.length === 1 ? "opção" : "opções"}` : titulo}
        valor={novo ? "" : valor}
        placeholder={cidade ? "Selecione o porto" : "Selecione primeiro a cidade"}
        desabilitado={!cidade}
        opcoes={filtrados}
        onChange={(escolha) => {setNovo(false); onChange(escolha);}} />
      {cidade && (
        <button type="button" onClick={() => {setNovo(true); onChange("");}}
          className="mt-2 min-h-10 w-full rounded-xl border border-dashed border-amber-300/30 bg-amber-300/[0.06] px-3 text-left text-xs font-black text-amber-200">
          + Cadastrar um novo porto ou ponto de embarque
        </button>
      )}
      {novo && (
        <div className="mt-2 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-2">
          <input autoFocus value={valor} onChange={(e) => onChange(e.target.value)}
            className={input} placeholder="Ex.: Porto da Manaus Moderna" />
          <p className="mt-1.5 text-xs leading-5 text-slate-400">
            Escreva o nome completo e correto. A equipe confirmará antes da aprovação.
          </p>
          <button type="button" onClick={() => {setNovo(false); onChange("");}}
            className="mt-2 text-xs font-black text-slate-300">Cancelar novo porto</button>
        </div>
      )}
      {cidade && !novo && (
        <p className="mt-1.5 text-xs text-slate-400">
          {filtrados.length
            ? "Toque para ver e selecionar os portos desta localidade."
            : "Nenhum porto cadastrado nesta localidade. Você poderá informar um novo."}
        </p>
      )}
    </div>
  );
}

function opcoesDiasApos() {
  return Array.from({length: 31}, (_, dia) => ({
    valor: String(dia),
    rotulo: dia === 0 ? "Mesmo dia" : dia === 1 ? "1 dia após" : `${dia} dias após`,
  }));
}

function SeletorDias({
  titulo,
  dias,
  cor = "sky",
  onChange,
}: {
  titulo: string;
  dias: number[];
  cor?: "sky" | "emerald" | "amber";
  onChange: (dias: number[]) => void;
}) {
  const ativo = cor === "emerald" ? "bg-emerald-500" : cor === "amber" ? "bg-amber-400 text-slate-950" : "bg-sky-500";
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-300">{titulo}</p>
      <div className="grid grid-cols-7 gap-1">
        {DIAS.map((dia, numero) => {
          const selecionado = dias.includes(numero);
          return (
            <button type="button" key={numero} title={NOMES_DIAS[numero]}
              onClick={() => onChange(selecionado
                ? dias.filter((item) => item !== numero)
                : [...dias, numero].sort())}
              className={`h-11 min-w-0 rounded-xl px-0.5 text-[10px] font-black sm:text-xs ${
                selecionado ? `${ativo} text-white` : "bg-white/8 text-slate-300"
              }`}>
              {dia}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProgramacaoSentido({
  rota,
  cor,
  titulo,
  subtitulo,
  onAtualizar,
  onAlternarDia,
  onEditarHorarioEscala,
}: {
  rota: RotaCadastro;
  cor: "sky" | "emerald";
  titulo: string;
  subtitulo: string;
  onAtualizar: (campos: Partial<RotaCadastro>) => void;
  onAlternarDia: (dia: number) => void;
  onEditarHorarioEscala: (indice: number, campos: Partial<EscalaCadastro>) => void;
}) {
  const borda = cor === "sky" ? "border-sky-400/25 bg-sky-400/[0.055]" : "border-emerald-400/25 bg-emerald-400/[0.055]";
  const destaque = cor === "sky" ? "bg-sky-500" : "bg-emerald-500";
  const textoCor = cor === "sky" ? "text-sky-300" : "text-emerald-300";
  return (
    <section className={`rounded-3xl border p-3 sm:p-5 ${borda}`}>
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-lg font-black text-white ${destaque}`}>
          {rota.sentido === "ida" ? "→" : "←"}
        </span>
        <div className="min-w-0">
          <p className={`text-xs font-black uppercase tracking-[0.18em] ${textoCor}`}>{titulo}</p>
          <h3 className="mt-1 break-words text-lg font-black">{subtitulo}</h3>
        </div>
      </div>

      <div className="mt-4 border-t border-white/10 pt-4 sm:rounded-2xl sm:border sm:bg-[#071a2f]/80 sm:p-4">
        <p className="text-xs font-black uppercase tracking-wide text-slate-300">Quando esta viagem sai?</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
          <div className="min-w-0">
            <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-300">Dias de saída</p>
            <div className="grid grid-cols-7 gap-1">
              {DIAS.map((dia, numero) => (
                <button type="button" key={numero} title={NOMES_DIAS[numero]} onClick={() => onAlternarDia(numero)}
                  className={`h-11 min-w-0 rounded-xl px-0.5 text-[10px] font-black sm:text-xs ${rota.diasSemana.includes(numero) ? `${destaque} text-white` : "bg-white/8 text-slate-300"}`}>
                  {dia}
                </button>
              ))}
            </div>
          </div>
          <HorarioCompacto
            titulo={rota.sentido === "ida" ? "Saída da origem" : "Saída do destino"}
            valor={rota.horarioSaida}
            onChange={(valor) => onAtualizar({horarioSaida: valor})}
          />
        </div>
      </div>

      {rota.escalas.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-black">Horários nas escalas</p>
          <p className="mt-1 text-xs text-slate-400">Informe chegada e nova saída somente quando souber.</p>
          <div className="mt-3 space-y-2">
            {rota.escalas.map((escala, indice) => (
              <div key={`${escala.cidade}_${escala.porto}_${indice}`} className="border-t border-white/10 py-3 first:border-t-0 sm:rounded-2xl sm:border-0 sm:bg-white/[0.055] sm:p-3">
                <div className="flex items-center gap-2">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black text-white ${destaque}`}>{indice + 1}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{escala.porto || escala.cidade || `Escala ${indice + 1}`}</p>
                    <p className="truncate text-xs text-slate-400">{escala.cidade}</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <SeletorLista titulo="Dia após a saída" valor={String(escala.diaRelativo)}
                    placeholder="Selecione" pesquisavel={false} opcoes={opcoesDiasApos()}
                    onChange={(valor) => onEditarHorarioEscala(indice, {diaRelativo: Number(valor)})} />
                  <HorarioCompacto titulo="Chegada" valor={escala.horarioChegada}
                    onChange={(valor) => onEditarHorarioEscala(indice, {horarioChegada: valor})} />
                  <HorarioCompacto titulo="Nova saída" valor={escala.horarioSaida}
                    onChange={(valor) => onEditarHorarioEscala(indice, {horarioSaida: valor})} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-white/10 pt-4 sm:rounded-2xl sm:border sm:bg-white/[0.035] sm:p-4">
        <p className="text-xs font-black uppercase tracking-wide text-slate-300">
          Chegada ao destino final: {rota.destinoCidade || "destino ainda não selecionado"}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <SeletorLista titulo="Dia de chegada" valor={String(rota.destinoDiaRelativo || 0)}
            placeholder="Selecione" pesquisavel={false} opcoes={opcoesDiasApos()}
            onChange={(valor) => onAtualizar({destinoDiaRelativo: Number(valor)})} />
          <HorarioCompacto titulo="Horário de chegada" valor={rota.destinoHorarioChegada || ""}
            onChange={(valor) => onAtualizar({destinoHorarioChegada: valor})} />
        </div>
      </div>
    </section>
  );
}

export default function RotasCadastroPublico({
  value, onChange,
}: {value: RotaCadastro[]; onChange: (rotas: RotaCadastro[]) => void}) {
  const [portos, setPortos] = useState<Opcao[]>([]);
  const [abaAtiva, setAbaAtiva] = useState<"ida" | "volta">("ida");
  useEffect(() => {
    const dados = new Map<string, Opcao>();
    const carregar = (nomeColecao: "portos" | "terminais") =>
      onSnapshot(collection(db, nomeColecao), (snapshot) => {
        snapshot.docs.forEach((documento) => {
          const item = documento.data() as Record<string, unknown>;
          const nome = formatarNomeLocal(item.nome || item.porto || item.terminal || documento.id);
          const cidade = formatarNomeLocal(item.cidade || item.municipio || "");
          const chave = `${normalizar(nome)}|${normalizar(cidade)}`;
          if (!dados.has(chave)) {
            dados.set(chave, {
              valor: nome,
              rotulo: cidade && !normalizar(nome).includes(normalizar(cidade)) ? `${nome} — ${cidade}` : nome,
              busca: cidade,
            });
          }
        });
        setPortos(Array.from(dados.values()).sort((a, b) => a.rotulo.localeCompare(b.rotulo)));
      });
    const pararPortos = carregar("portos");
    const pararTerminais = carregar("terminais");
    return () => {pararPortos(); pararTerminais();};
  }, []);

  const rotas = useMemo(() => {
    const lista = Array.isArray(value) ? value : [];
    const idaSalva = lista.find((rota) => rota?.sentido === "ida");
    const ida = normalizarRotaSalva(idaSalva, "ida");
    const voltaSalva = lista.find((rota) => rota?.sentido === "volta");
    const volta: RotaCadastro = {
      ...normalizarRotaSalva(voltaSalva, "volta"),
      sentido: "volta",
      origemUf: textoSeguro(
        (voltaSalva as RotaCadastro | undefined)?.origemUf || ida.destinoUf,
      ),
      origemCidade: textoSeguro(
        (voltaSalva as RotaCadastro | undefined)?.origemCidade || ida.destinoCidade,
      ),
      portoOrigem: textoSeguro(
        (voltaSalva as RotaCadastro | undefined)?.portoOrigem || ida.portoDestino,
      ),
      destinoUf: textoSeguro(
        (voltaSalva as RotaCadastro | undefined)?.destinoUf || ida.origemUf,
      ),
      destinoCidade: textoSeguro(
        (voltaSalva as RotaCadastro | undefined)?.destinoCidade || ida.origemCidade,
      ),
      portoDestino: textoSeguro(
        (voltaSalva as RotaCadastro | undefined)?.portoDestino || ida.portoOrigem,
      ),
    };
    return [ida, volta] as [RotaCadastro, RotaCadastro];
  }, [value]);

  const [ida, volta] = rotas;
  const emitir = (novaIda: RotaCadastro, novaVolta: RotaCadastro) => onChange([novaIda, novaVolta]);
  const atualizarIda = (campos: Partial<RotaCadastro>) => emitir({...ida, ...campos}, volta);
  const atualizarVolta = (campos: Partial<RotaCadastro>) => emitir(ida, {...volta, ...campos});
  const atualizarPercurso = (camposIda: Partial<RotaCadastro>, camposVolta: Partial<RotaCadastro>) =>
    emitir({...ida, ...camposIda}, {...volta, ...camposVolta});
  const adicionarEscala = (sentido: "ida" | "volta") => {
    const nova = {uf: "", cidade: "", porto: "", diasPassagem: [], diaRelativo: 0, horarioChegada: "", horarioSaida: ""};
    if (sentido === "ida") atualizarIda({escalas: [...ida.escalas, nova]});
    else atualizarVolta({escalas: [...volta.escalas, nova]});
  };
  const editarLocalEscala = (sentido: "ida" | "volta", indice: number, campos: Partial<EscalaCadastro>) => {
    const rota = sentido === "ida" ? ida : volta;
    const escalas = rota.escalas.map((escala, atual) => atual === indice ? {...escala, ...campos} : escala);
    if (sentido === "ida") atualizarIda({escalas});
    else atualizarVolta({escalas});
  };
  const removerEscala = (sentido: "ida" | "volta", indice: number) => {
    const rota = sentido === "ida" ? ida : volta;
    const escalas = rota.escalas.filter((_, atual) => atual !== indice);
    if (sentido === "ida") atualizarIda({escalas});
    else atualizarVolta({escalas});
  };
  const alternarDia = (sentido: "ida" | "volta", dia: number) => {
    const rota = sentido === "ida" ? ida : volta;
    const diasSemana = rota.diasSemana.includes(dia)
      ? rota.diasSemana.filter((item) => item !== dia)
      : [...rota.diasSemana, dia].sort();
    sentido === "ida" ? atualizarIda({diasSemana}) : atualizarVolta({diasSemana});
  };

  const nomeOrigem = ida.origemCidade.replace(/\s-\s[A-Z]{2}$/, "") || "Origem";
  const nomeDestino = ida.destinoCidade.replace(/\s-\s[A-Z]{2}$/, "") || "Destino";

  return (
    <div className="space-y-5">
      <section className="rounded-3xl border border-amber-400/20 bg-amber-400/[0.045] p-4 sm:p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">1. Percurso principal</p>
        <h3 className="mt-1 text-xl font-black">Informe os locais apenas uma vez</h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          A origem e o destino serão reutilizados. As escalas serão preenchidas separadamente nas abas de ida e volta.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SeletorMunicipio titulo="Local de partida" uf={ida.origemUf} cidade={ida.origemCidade}
            onUf={(valor) => atualizarPercurso(
              {origemUf: valor, origemCidade: "", portoOrigem: ""},
              {destinoUf: valor, destinoCidade: "", portoDestino: ""},
            )}
            onCidade={(valor) => atualizarPercurso(
              {origemCidade: valor, portoOrigem: ""},
              {destinoCidade: valor, portoDestino: ""},
            )} />
          <SeletorMunicipio titulo="Destino final" uf={ida.destinoUf} cidade={ida.destinoCidade}
            onUf={(valor) => atualizarPercurso(
              {destinoUf: valor, destinoCidade: "", portoDestino: ""},
              {origemUf: valor, origemCidade: "", portoOrigem: ""},
            )}
            onCidade={(valor) => atualizarPercurso(
              {destinoCidade: valor, portoDestino: ""},
              {origemCidade: valor, portoOrigem: ""},
            )} />
          <SeletorPorto titulo="Porto de partida" valor={ida.portoOrigem} cidade={ida.origemCidade} portos={portos}
            onChange={(valor) => atualizarPercurso({portoOrigem: valor}, {portoDestino: valor})} />
          <SeletorPorto titulo="Porto do destino final" valor={ida.portoDestino} cidade={ida.destinoCidade} portos={portos}
            onChange={(valor) => atualizarPercurso({portoDestino: valor}, {portoOrigem: valor})} />
        </div>

      </section>

      <section className="rounded-3xl border border-white/10 bg-[#071a2f] p-4 sm:p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">2. Rotas e escalas</p>
        <h3 className="mt-1 text-xl font-black">Preencha cada sentido separadamente</h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Alterne entre as abas. As informações de ida e volta não serão misturadas.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-white/[0.045] p-1.5">
          <button type="button" onClick={() => setAbaAtiva("ida")}
            className={`min-h-12 rounded-xl px-3 text-sm font-black ${
              abaAtiva === "ida" ? "bg-sky-500 text-white shadow-lg" : "text-slate-400"
            }`}>
            IDA · {nomeOrigem} → {nomeDestino}
          </button>
          <button type="button" onClick={() => setAbaAtiva("volta")}
            className={`min-h-12 rounded-xl px-3 text-sm font-black ${
              abaAtiva === "volta" ? "bg-emerald-500 text-white shadow-lg" : "text-slate-400"
            }`}>
            VOLTA · {nomeDestino} → {nomeOrigem}
          </button>
        </div>

        {(["ida", "volta"] as const).map((sentido) => {
          if (sentido !== abaAtiva) return null;
          const rota = sentido === "ida" ? ida : volta;
          const cor = sentido === "ida" ? "sky" : "emerald";
          const atualizarRota = sentido === "ida" ? atualizarIda : atualizarVolta;
          return (
            <div key={sentido} className="mt-5">
              <p className={`text-sm font-black ${sentido === "ida" ? "text-sky-300" : "text-emerald-300"}`}>
                {sentido === "ida"
                  ? `${nomeOrigem} → ${nomeDestino}`
                  : `${nomeDestino} → ${nomeOrigem}`}
              </p>
              <div className="mt-3 border-t border-white/10 pt-4">
                <SeletorDias
                  titulo={sentido === "ida" ? "Dias de saída da origem" : "Dias de saída do destino"}
                  cor={cor}
                  dias={rota.diasSemana}
                  onChange={(diasSemana) => atualizarRota({diasSemana})}
                />
              </div>

              <div className="mt-5 border-t border-white/10 pt-4">
                <h4 className="font-black">Escalas da {sentido}</h4>
                <p className="mt-1 text-xs text-slate-400">
                  Cadastre na ordem em que a embarcação passa neste sentido.
                </p>
                <div className="mt-3 space-y-3">
                  {rota.escalas.map((escala, indice) => (
                    <div key={indice} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
                      <div className="mb-3 flex items-center justify-between">
                        <strong className="text-sm">Escala {indice + 1}</strong>
                        <button type="button" onClick={() => removerEscala(sentido, indice)}
                          className="text-xs font-black text-red-300">Remover</button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <SeletorMunicipio titulo="Cidade ou comunidade" uf={escala.uf || ""} cidade={escala.cidade}
                          onUf={(valor) => editarLocalEscala(sentido, indice, {uf: valor, cidade: "", porto: ""})}
                          onCidade={(valor) => editarLocalEscala(sentido, indice, {cidade: valor, porto: ""})} />
                        <SeletorPorto titulo="Porto ou ponto de parada" valor={escala.porto}
                          cidade={escala.cidade} portos={portos}
                          onChange={(valor) => editarLocalEscala(sentido, indice, {porto: valor})} />
                      </div>
                      <div className="mt-3">
                        <SeletorDias titulo={`Dias previstos de passagem na ${sentido}`} cor={cor}
                          dias={escala.diasPassagem || []}
                          onChange={(diasPassagem) => editarLocalEscala(sentido, indice, {diasPassagem})} />
                      </div>
                    </div>
                  ))}
                  {!rota.escalas.length && (
                    <p className="border-y border-dashed border-white/10 py-5 text-center text-xs text-slate-400">
                      Nenhuma escala cadastrada para a {sentido}.
                    </p>
                  )}
                </div>
                <button type="button" onClick={() => adicionarEscala(sentido)}
                  className={`mt-4 min-h-12 w-full rounded-xl border border-dashed px-4 text-sm font-black ${
                    sentido === "ida"
                      ? "border-sky-400/35 bg-sky-400/[0.07] text-sky-200"
                      : "border-emerald-400/35 bg-emerald-400/[0.07] text-emerald-200"
                  }`}>
                  + Adicionar outra escala na {sentido}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.055] p-4">
        <p className="text-sm font-black text-emerald-200">Cadastro rápido do Plano Básico</p>
        <p className="mt-1 text-xs leading-5 text-slate-300">
          Horários, contatos comerciais, galeria e acompanhamento em tempo real serão preenchidos depois, em um link exclusivo, caso você escolha um plano pago.
        </p>
      </div>
    </div>
  );
}
