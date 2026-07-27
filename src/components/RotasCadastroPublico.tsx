import React, {useEffect, useMemo, useState} from "react";

type Uf = {id: number; sigla: string; nome: string};
type Municipio = {id: number; nome: string};

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

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const UFS: Uf[] = [
  ["AC", "Acre"], ["AL", "Alagoas"], ["AP", "Amapá"], ["AM", "Amazonas"],
  ["BA", "Bahia"], ["CE", "Ceará"], ["DF", "Distrito Federal"],
  ["ES", "Espírito Santo"], ["GO", "Goiás"], ["MA", "Maranhão"],
  ["MT", "Mato Grosso"], ["MS", "Mato Grosso do Sul"], ["MG", "Minas Gerais"],
  ["PA", "Pará"], ["PB", "Paraíba"], ["PR", "Paraná"], ["PE", "Pernambuco"],
  ["PI", "Piauí"], ["RJ", "Rio de Janeiro"], ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"], ["RO", "Rondônia"], ["RR", "Roraima"],
  ["SC", "Santa Catarina"], ["SP", "São Paulo"], ["SE", "Sergipe"],
  ["TO", "Tocantins"],
].map(([sigla, nome], indice) => ({id: indice + 1, sigla, nome}));
const ROTA_VAZIA: RotaCadastro = {
  sentido: "ida",
  origemUf: "",
  origemCidade: "",
  portoOrigem: "",
  destinoUf: "",
  destinoCidade: "",
  portoDestino: "",
  diasSemana: [],
  horarioSaida: "",
  duracaoHoras: 0,
  duracaoNaoInformada: true,
  escalas: [],
};

function SeletorMunicipio({
  titulo,
  uf,
  cidade,
  ufs,
  onUf,
  onCidade,
}: {
  titulo: string;
  uf: string;
  cidade: string;
  ufs: Uf[];
  onUf: (valor: string) => void;
  onCidade: (valor: string) => void;
}) {
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!uf) {
      setMunicipios([]);
      return;
    }
    setCarregando(true);
    setErro(false);
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`)
      .then((resposta) => {
        if (!resposta.ok) throw new Error("IBGE indisponível");
        return resposta.json();
      })
      .then((dados) => setMunicipios(Array.isArray(dados) ? dados : []))
      .catch(() => {
        setMunicipios([]);
        setErro(true);
      })
      .finally(() => setCarregando(false));
  }, [tentativa, uf]);

  const classe = "mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#10253e] px-3 text-sm text-white";
  return (
    <div>
      <p className="text-sm font-black text-slate-200">{titulo}</p>
      <div className="mt-2 grid grid-cols-[120px_1fr] gap-2">
        <select value={uf} onChange={(e) => {onUf(e.target.value); onCidade("");}} className={classe}>
          <option value="">Estado</option>
          {ufs.map((item) => <option key={item.id} value={item.sigla}>{item.sigla}</option>)}
        </select>
        <select value={cidade} onChange={(e) => onCidade(e.target.value)} className={classe} disabled={!uf || carregando}>
          <option value="">{carregando ? "Carregando..." : erro ? "Não foi possível carregar" : "Selecione o município"}</option>
          {municipios.map((item) => <option key={item.id} value={`${item.nome} - ${uf}`}>{item.nome}</option>)}
        </select>
      </div>
      {erro && (
        <button type="button" onClick={() => setTentativa((valor) => valor + 1)}
          className="mt-2 text-xs font-black text-amber-300">
          Tentar carregar os municípios novamente
        </button>
      )}
    </div>
  );
}

export default function RotasCadastroPublico({
  value,
  onChange,
}: {
  value: RotaCadastro[];
  onChange: (rotas: RotaCadastro[]) => void;
}) {
  const rotas = useMemo(() => value.length ? value : [{...ROTA_VAZIA}], [value]);
  function atualizar(indice: number, campo: keyof RotaCadastro, valor: unknown) {
    onChange(rotas.map((rota, atual) => atual === indice ? {...rota, [campo]: valor} : rota));
  }
  function adicionarEscala(indice: number) {
    atualizar(indice, "escalas", [...rotas[indice].escalas, {
      cidade: "", porto: "", diaRelativo: 0, horarioChegada: "", horarioSaida: "",
    }]);
  }
  function editarEscala(indiceRota: number, indiceEscala: number, campo: keyof EscalaCadastro, valor: string | number) {
    const escalas = rotas[indiceRota].escalas.map((escala, indice) =>
      indice === indiceEscala ? {...escala, [campo]: valor} : escala);
    atualizar(indiceRota, "escalas", escalas);
  }
  function alternarDia(indice: number, dia: number) {
    const atuais = rotas[indice].diasSemana;
    atualizar(indice, "diasSemana", atuais.includes(dia) ? atuais.filter((item) => item !== dia) : [...atuais, dia].sort());
  }

  const input = "mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#10253e] px-3 text-sm text-white outline-none focus:border-sky-400";
  return (
    <div className="space-y-5">
      {rotas.map((rota, indice) => (
        <section key={indice} className="rounded-3xl border border-sky-400/15 bg-sky-400/[0.05] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-black">Rota {indice + 1}</h3>
            {rotas.length > 1 && <button type="button" onClick={() => onChange(rotas.filter((_, i) => i !== indice))} className="text-xs font-black text-red-300">REMOVER</button>}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-bold">Sentido
              <select value={rota.sentido} onChange={(e) => atualizar(indice, "sentido", e.target.value)} className={input}>
                <option value="ida">Ida</option><option value="volta">Volta</option>
              </select>
            </label>
            <div>
              <label className="text-sm font-bold">Duração aproximada em horas (opcional)
                <input type="number" min={0} disabled={rota.duracaoNaoInformada}
                  value={rota.duracaoNaoInformada ? "" : rota.duracaoHoras || ""}
                  onChange={(e) => atualizar(indice, "duracaoHoras", Number(e.target.value))} className={input} />
              </label>
              <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-300">
                <input type="checkbox" checked={rota.duracaoNaoInformada !== false}
                  onChange={(e) => atualizar(indice, "duracaoNaoInformada", e.target.checked)} />
                Não sei informar a duração
              </label>
            </div>
            <SeletorMunicipio titulo="Origem" uf={rota.origemUf} cidade={rota.origemCidade} ufs={UFS}
              onUf={(v) => atualizar(indice, "origemUf", v)} onCidade={(v) => atualizar(indice, "origemCidade", v)} />
            <SeletorMunicipio titulo="Destino" uf={rota.destinoUf} cidade={rota.destinoCidade} ufs={UFS}
              onUf={(v) => atualizar(indice, "destinoUf", v)} onCidade={(v) => atualizar(indice, "destinoCidade", v)} />
            <label className="text-sm font-bold">Porto de origem
              <input value={rota.portoOrigem} onChange={(e) => atualizar(indice, "portoOrigem", e.target.value)} className={input} />
            </label>
            <label className="text-sm font-bold">Porto de destino
              <input value={rota.portoDestino} onChange={(e) => atualizar(indice, "portoDestino", e.target.value)} className={input} />
            </label>
            <label className="text-sm font-bold">Horário previsto de saída
              <input type="time" value={rota.horarioSaida} onChange={(e) => atualizar(indice, "horarioSaida", e.target.value)} className={input} />
            </label>
            <div>
              <p className="text-sm font-bold">Dias de saída</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {DIAS.map((dia, numero) => <button type="button" key={dia} onClick={() => alternarDia(indice, numero)}
                  className={`rounded-xl px-2.5 py-2 text-xs font-black ${rota.diasSemana.includes(numero) ? "bg-sky-500 text-white" : "bg-white/8 text-slate-300"}`}>{dia}</button>)}
              </div>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between"><h4 className="font-black">Escalas</h4>
              <button type="button" onClick={() => adicionarEscala(indice)} className="rounded-xl bg-amber-400 px-3 py-2 text-xs font-black text-slate-950">+ ADICIONAR ESCALA</button>
            </div>
            {rota.escalas.map((escala, escalaIndice) => (
              <div key={escalaIndice} className="rounded-2xl bg-white/[0.06] p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-bold">Cidade/comunidade
                    <input value={escala.cidade} onChange={(e) => editarEscala(indice, escalaIndice, "cidade", e.target.value)} className={input} />
                  </label>
                  <label className="text-xs font-bold">Porto/ponto de embarque
                    <input value={escala.porto} onChange={(e) => editarEscala(indice, escalaIndice, "porto", e.target.value)} className={input} />
                  </label>
                  <label className="text-xs font-bold">Chegada prevista
                    <input type="time" value={escala.horarioChegada} onChange={(e) => editarEscala(indice, escalaIndice, "horarioChegada", e.target.value)} className={input} />
                  </label>
                  <label className="text-xs font-bold">Dias após a partida
                    <select value={escala.diaRelativo} onChange={(e) => editarEscala(indice, escalaIndice, "diaRelativo", Number(e.target.value))} className={input}>
                      {Array.from({length: 31}, (_, dia) => (
                        <option key={dia} value={dia}>{dia === 0 ? "Mesmo dia da partida" : dia === 1 ? "1 dia após" : `${dia} dias após`}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button type="button" onClick={() => atualizar(indice, "escalas", rota.escalas.filter((_, i) => i !== escalaIndice))}
                  className="mt-3 text-xs font-black text-red-300">Remover escala</button>
              </div>
            ))}
          </div>
        </section>
      ))}
      <button type="button" onClick={() => onChange([...rotas, {...ROTA_VAZIA, sentido: rotas.some((r) => r.sentido === "volta") ? "ida" : "volta"}])}
        className="min-h-12 w-full rounded-2xl border border-dashed border-sky-400/40 font-black text-sky-200">+ Adicionar outra rota ou sentido</button>
      <p className="text-xs leading-5 text-slate-400">Preencha tudo agora. No plano Básico, dias e horários ficarão guardados e ocultos; serão liberados automaticamente no Vitrine ou Tempo Real.</p>
    </div>
  );
}
