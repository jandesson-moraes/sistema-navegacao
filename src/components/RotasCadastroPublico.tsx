import React, {useEffect, useMemo, useState} from "react";
import {collection, onSnapshot} from "firebase/firestore";
import {db} from "../config/firebase";

type Uf = {id: number; sigla: string; nome: string};
type Municipio = {id: number; nome: string};
type Opcao = {valor: string; rotulo: string; busca?: string};

export type EscalaCadastro = {
  cidade: string;
  porto: string;
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
  duracaoHoras: number;
  duracaoNaoInformada?: boolean;
  escalas: EscalaCadastro[];
};

const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];
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
  horarioSaida: "", duracaoHoras: 0, duracaoNaoInformada: true, escalas: [],
};

function normalizar(valor: unknown) {
  return String(valor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
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
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 p-3 sm:items-center">
          <button type="button" aria-label="Fechar" onClick={() => setAberto(false)} className="absolute inset-0" />
          <div className="relative z-10 max-h-[78vh] w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#071a2f] shadow-2xl">
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
            <div className="max-h-[56vh] overflow-y-auto px-3 pb-3">
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
          onChange={(valor) => {onUf(valor); onCidade("");}} />
        <SeletorLista valor={cidade}
          placeholder={carregando ? "Carregando..." : erro ? "Falha ao carregar" : "Município"}
          desabilitado={!uf || carregando || erro}
          opcoes={municipios.map((item) => ({valor: `${item.nome} - ${uf}`, rotulo: item.nome}))}
          onChange={onCidade} />
      </div>
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
  const filtrados = portos.filter((item) => !cidade || normalizar(item.busca).includes(normalizar(cidade.replace(/\s-\s[A-Z]{2}$/, ""))));
  const input = "mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#10253e] px-3 text-sm text-white outline-none";
  return (
    <div>
      <SeletorLista titulo={titulo} valor={novo ? "" : valor} placeholder="Selecione o porto"
        opcoes={[...filtrados, {valor: "__novo__", rotulo: "+ Não encontrei — informar novo porto"}]}
        onChange={(escolha) => {
          if (escolha === "__novo__") {setNovo(true); onChange("");}
          else {setNovo(false); onChange(escolha);}
        }} />
      {novo && <input autoFocus value={valor} onChange={(e) => onChange(e.target.value)}
        className={input} placeholder="Nome do novo porto ou ponto de embarque" />}
    </div>
  );
}

export default function RotasCadastroPublico({
  value, onChange,
}: {value: RotaCadastro[]; onChange: (rotas: RotaCadastro[]) => void}) {
  const [portos, setPortos] = useState<Opcao[]>([]);
  useEffect(() => {
    const dados = new Map<string, Opcao>();
    const carregar = (nomeColecao: "portos" | "terminais") =>
      onSnapshot(collection(db, nomeColecao), (snapshot) => {
        snapshot.docs.forEach((documento) => {
          const item = documento.data() as Record<string, unknown>;
          const nome = String(item.nome || item.porto || item.terminal || documento.id);
          const cidade = String(item.cidade || item.municipio || "");
          dados.set(`${nomeColecao}:${documento.id}`, {
            valor: nome, rotulo: cidade ? `${nome} — ${cidade}` : nome, busca: cidade,
          });
        });
        setPortos(Array.from(dados.values()).sort((a, b) => a.rotulo.localeCompare(b.rotulo)));
      });
    const pararPortos = carregar("portos");
    const pararTerminais = carregar("terminais");
    return () => {pararPortos(); pararTerminais();};
  }, []);

  const rotas = useMemo(() => value.length ? value : [{...ROTA_VAZIA}], [value]);
  const atualizar = (indice: number, campo: keyof RotaCadastro, valor: unknown) =>
    onChange(rotas.map((rota, atual) => atual === indice ? {...rota, [campo]: valor} : rota));
  const alternarDia = (indice: number, dia: number) => {
    const atuais = rotas[indice].diasSemana;
    atualizar(indice, "diasSemana", atuais.includes(dia) ? atuais.filter((item) => item !== dia) : [...atuais, dia].sort());
  };
  const adicionarEscala = (indice: number) => atualizar(indice, "escalas", [...rotas[indice].escalas, {
    cidade: "", porto: "", diaRelativo: 0, horarioChegada: "", horarioSaida: "",
  }]);
  const editarEscala = (r: number, e: number, campo: keyof EscalaCadastro, valor: string | number) =>
    atualizar(r, "escalas", rotas[r].escalas.map((escala, i) => i === e ? {...escala, [campo]: valor} : escala));
  const input = "mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#10253e] px-3 text-sm text-white outline-none";

  return (
    <div className="space-y-4">
      {rotas.map((rota, indice) => (
        <section key={indice} className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.045] p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500 text-xs font-black">{indice + 1}</span>
              <h3 className="font-black">Rota {rota.sentido === "volta" ? "de volta" : "de ida"}</h3>
            </div>
            {rotas.length > 1 && <button type="button" onClick={() => onChange(rotas.filter((_, i) => i !== indice))} className="text-xs font-black text-red-300">Remover</button>}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SeletorLista titulo="Sentido" valor={rota.sentido} placeholder="Sentido" pesquisavel={false}
              opcoes={[{valor: "ida", rotulo: "Ida"}, {valor: "volta", rotulo: "Volta"}]}
              onChange={(v) => atualizar(indice, "sentido", v)} />
            <div>
              <label className="text-xs font-black uppercase tracking-wide text-slate-300">Duração aproximada (opcional)
                <input type="number" min={0} disabled={rota.duracaoNaoInformada}
                  value={rota.duracaoNaoInformada ? "" : rota.duracaoHoras || ""}
                  onChange={(e) => atualizar(indice, "duracaoHoras", Number(e.target.value))} className={input} />
              </label>
              <label className="mt-1.5 flex items-center gap-2 text-xs font-bold text-slate-300">
                <input type="checkbox" checked={rota.duracaoNaoInformada !== false}
                  onChange={(e) => atualizar(indice, "duracaoNaoInformada", e.target.checked)} />
                Não sei informar
              </label>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <SeletorMunicipio titulo="De onde sai?" uf={rota.origemUf} cidade={rota.origemCidade}
              onUf={(v) => atualizar(indice, "origemUf", v)} onCidade={(v) => atualizar(indice, "origemCidade", v)} />
            <SeletorMunicipio titulo="Para onde vai?" uf={rota.destinoUf} cidade={rota.destinoCidade}
              onUf={(v) => atualizar(indice, "destinoUf", v)} onCidade={(v) => atualizar(indice, "destinoCidade", v)} />
            <SeletorPorto titulo="Porto de origem" valor={rota.portoOrigem} cidade={rota.origemCidade} portos={portos}
              onChange={(v) => atualizar(indice, "portoOrigem", v)} />
            <SeletorPorto titulo="Porto de destino" valor={rota.portoDestino} cidade={rota.destinoCidade} portos={portos}
              onChange={(v) => atualizar(indice, "portoDestino", v)} />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]">
            <HorarioCompacto titulo="Horário previsto" valor={rota.horarioSaida}
              onChange={(v) => atualizar(indice, "horarioSaida", v)} />
            <div className="min-w-0">
              <p className="mb-1.5 text-xs font-black uppercase tracking-wide text-slate-300">Dias de saída</p>
              <div className="flex flex-nowrap gap-1 overflow-x-auto pb-1">
                {DIAS.map((dia, numero) => (
                  <button type="button" key={numero} title={NOMES_DIAS[numero]} onClick={() => alternarDia(indice, numero)}
                    className={`h-11 min-w-9 flex-1 rounded-xl px-2 text-xs font-black ${rota.diasSemana.includes(numero) ? "bg-sky-500 text-white" : "bg-white/8 text-slate-300"}`}>
                    {dia}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="flex items-center justify-between">
              <div><h4 className="font-black">Escalas</h4><p className="text-xs text-slate-400">Adicione somente se houver.</p></div>
              <button type="button" onClick={() => adicionarEscala(indice)}
                className="rounded-xl bg-amber-400 px-3 py-2 text-xs font-black text-slate-950">+ Escala</button>
            </div>
            <div className="mt-3 space-y-2">
              {rota.escalas.map((escala, escalaIndice) => (
                <div key={escalaIndice} className="rounded-2xl bg-white/[0.055] p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-black uppercase text-slate-300">Cidade ou comunidade
                      <input value={escala.cidade} onChange={(e) => editarEscala(indice, escalaIndice, "cidade", e.target.value)}
                        className={input} placeholder="Selecione ou informe" />
                    </label>
                    <SeletorPorto titulo="Porto da escala" valor={escala.porto} cidade={escala.cidade} portos={portos}
                      onChange={(v) => editarEscala(indice, escalaIndice, "porto", v)} />
                    <HorarioCompacto titulo="Chegada prevista" valor={escala.horarioChegada}
                      onChange={(v) => editarEscala(indice, escalaIndice, "horarioChegada", v)} />
                    <SeletorLista titulo="Dias após a partida" valor={String(escala.diaRelativo)}
                      placeholder="Selecione" pesquisavel={false}
                      opcoes={Array.from({length: 31}, (_, dia) => ({
                        valor: String(dia),
                        rotulo: dia === 0 ? "Mesmo dia" : dia === 1 ? "1 dia após" : `${dia} dias após`,
                      }))}
                      onChange={(v) => editarEscala(indice, escalaIndice, "diaRelativo", Number(v))} />
                  </div>
                  <button type="button" onClick={() => atualizar(indice, "escalas", rota.escalas.filter((_, i) => i !== escalaIndice))}
                    className="mt-2 text-xs font-black text-red-300">Remover escala</button>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
      <button type="button" onClick={() => onChange([...rotas, {...ROTA_VAZIA, sentido: rotas.some((r) => r.sentido === "volta") ? "ida" : "volta"}])}
        className="min-h-11 w-full rounded-xl border border-dashed border-sky-400/40 text-sm font-black text-sky-200">
        + Adicionar rota de volta ou outra saída
      </button>
      <p className="text-xs leading-5 text-slate-400">Preencha agora e aprove uma vez. O sistema mostra automaticamente apenas o que o plano atual permite.</p>
    </div>
  );
}
