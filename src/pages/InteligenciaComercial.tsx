import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { auth, db } from "../config/firebase";

type RankingItem = {
  nome: string;
  quantidade: number;
  valor: number;
};

type Filtros = {
  mes: string;
  barco: string;
  rota: string;
  cidade: string;
};

const TODOS = "todos";

function statusPago(status: any) {
  const s = String(status || "")
    .toUpperCase()
    .trim();
  return s === "APROVADO" || s === "PAGO" || s === "CONCLUIDO";
}

function moeda(valor: number) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function parseData(data: any): Date | null {
  if (!data) return null;
  if (typeof data?.toDate === "function") return data.toDate();

  const d = new Date(String(data));
  return Number.isNaN(d.getTime()) ? null : d;
}

function chaveMes(data: any) {
  const d = parseData(data);
  if (!d) return "sem-data";

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function labelMes(chave: string) {
  if (chave === "sem-data") return "Sem data";

  const [ano, mes] = chave.split("-");

  return new Date(Number(ano), Number(mes) - 1, 1).toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  });
}

function rota(p: any) {
  return `${p.origem || "Origem"} → ${p.destino || "Destino"}`;
}

function cidade(p: any) {
  return (
    p.compradorCidadeResidenciaCompleta ||
    (p.compradorCidadeResidencia && p.compradorEstadoResidencia
      ? `${p.compradorCidadeResidencia} - ${p.compradorEstadoResidencia}`
      : "Sem cidade")
  );
}

function unicos(lista: string[]) {
  return Array.from(new Set(lista.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR"),
  );
}

function ranking(lista: any[], chave: (item: any) => string): RankingItem[] {
  const mapa = new Map<string, RankingItem>();

  lista.forEach((item) => {
    const nome = chave(item);
    if (!nome) return;

    const atual = mapa.get(nome) || { nome, quantidade: 0, valor: 0 };
    atual.quantidade += 1;
    atual.valor += Number(item.valor || 0);
    mapa.set(nome, atual);
  });

  return Array.from(mapa.values()).sort((a, b) => {
    if (b.valor !== a.valor) return b.valor - a.valor;
    return b.quantidade - a.quantidade;
  });
}

export default function InteligenciaComercial() {
  const [carregando, setCarregando] = useState(true);
  const [passagens, setPassagens] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [erro, setErro] = useState("");
  const [filtros, setFiltros] = useState<Filtros>({
    mes: TODOS,
    barco: TODOS,
    rota: TODOS,
    cidade: TODOS,
  });

  const email = auth.currentUser?.email || "";
  const podeAcessar =
    !email ||
    email === "jandessonmoraes@gmail.com" ||
    email === "Escdecastrousinagen@gmail.com" ||
    email === "escdecastrousinagen@gmail.com";

  const carregar = async () => {
    try {
      setErro("");
      setCarregando(true);

      const [passagensSnap, usuariosSnap] = await Promise.all([
        getDocs(collection(db, "passagens")),
        getDocs(collection(db, "usuarios")),
      ]);

      setPassagens(
        passagensSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => {
            const da = parseData(a.dataCompra)?.getTime() || 0;
            const dbb = parseData(b.dataCompra)?.getTime() || 0;
            return dbb - da;
          }),
      );

      setUsuarios(usuariosSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      setErro("Erro ao carregar dados.");
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => {
    carregar();
  }, []);

  const base = useMemo(() => {
    const pagas = passagens.filter((p) => statusPago(p.status));
    return pagas.length > 0 ? pagas : passagens;
  }, [passagens]);

  const opcoes = useMemo(
    () => ({
      meses: unicos(base.map((p) => chaveMes(p.dataCompra))).sort((a, b) =>
        b.localeCompare(a),
      ),
      barcos: unicos(base.map((p) => p.barco || "Embarcação")),
      rotas: unicos(base.map(rota)),
      cidades: unicos(base.map(cidade)),
    }),
    [base],
  );

  const filtradas = useMemo(() => {
    return base.filter((p) => {
      return (
        (filtros.mes === TODOS || chaveMes(p.dataCompra) === filtros.mes) &&
        (filtros.barco === TODOS || String(p.barco || "Embarcação") === filtros.barco) &&
        (filtros.rota === TODOS || rota(p) === filtros.rota) &&
        (filtros.cidade === TODOS || cidade(p) === filtros.cidade)
      );
    });
  }, [base, filtros]);

  const dados = useMemo(() => {
    const total = filtradas.reduce((s, p) => s + Number(p.valor || 0), 0);
    const ticket = filtradas.length ? total / filtradas.length : 0;

    const usuariosPorCidade = ranking(
      usuarios.map((u) => ({ ...u, valor: 0 })),
      (u) =>
        u.cidadeResidenciaCompleta ||
        (u.cidadeResidencia && u.estadoResidencia
          ? `${u.cidadeResidencia} - ${u.estadoResidencia}`
          : ""),
    );

    return {
      total,
      ticket,
      passagens: filtradas.length,
      cidades: ranking(filtradas, cidade),
      rotas: ranking(filtradas, rota),
      barcos: ranking(filtradas, (p) => p.barco || "Embarcação"),
      usuariosPorCidade,
    };
  }, [filtradas, usuarios]);

  const setFiltro = (campo: keyof Filtros, valor: string) => {
    setFiltros((atual) => ({ ...atual, [campo]: valor }));
  };

  const limpar = () => {
    setFiltros({
      mes: TODOS,
      barco: TODOS,
      rota: TODOS,
      cidade: TODOS,
    });
  };

  const Card = ({
    label,
    valor,
    sub,
    tom = "blue",
  }: {
    label: string;
    valor: string;
    sub?: string;
    tom?: "blue" | "green" | "amber" | "purple";
  }) => {
    const estilos = {
      blue: "border-[#7ba6d4]/25 bg-[#143760]",
      green: "border-emerald-300/25 bg-emerald-500/10",
      amber: "border-amber-300/25 bg-amber-500/10",
      purple: "border-violet-300/25 bg-violet-500/10",
    };

    return (
      <div className={`rounded-2xl border p-4 shadow-sm ${estilos[tom]}`}>
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-100/55">
          {label}
        </p>
        <p className="mt-2 text-2xl font-black text-white">{valor}</p>
        {sub && <p className="mt-1 text-xs text-sky-100/55">{sub}</p>}
      </div>
    );
  };

  const Select = ({
    value,
    onChange,
    options,
    todos,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    todos: string;
  }) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none focus:border-sky-300/60"
    >
      <option value={TODOS}>{todos}</option>
      {options.map((op) => (
        <option key={op.value} value={op.value}>
          {op.label}
        </option>
      ))}
    </select>
  );

  const Ranking = ({ titulo, lista }: { titulo: string; lista: RankingItem[] }) => (
    <div className="overflow-hidden rounded-3xl border border-[#7ba6d4]/25 bg-[#0f2240] shadow-sm">
      <div className="border-b border-white/10 bg-[#143760] px-5 py-4">
        <h2 className="text-sm font-black uppercase tracking-wide text-white">
          {titulo}
        </h2>
      </div>

      <div className="divide-y divide-white/10">
        {lista.length === 0 ? (
          <div className="p-6 text-sm text-sky-100/55">Sem dados.</div>
        ) : (
          lista.slice(0, 8).map((item, index) => (
            <div
              key={`${titulo}-${item.nome}`}
              className="flex items-center gap-4 px-5 py-4 transition hover:bg-[#17345e]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] text-xs font-black text-sky-100">
                {index + 1}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-black text-white">{item.nome}</p>
                <p className="text-xs text-sky-100/55">{item.quantidade} passagem(ns)</p>
              </div>

              <p className="text-sm font-black text-emerald-200">
                {item.valor > 0 ? moeda(item.valor) : "—"}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );

  if (!podeAcessar) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0c2c] p-8">
        <div className="rounded-3xl border border-red-300/25 bg-red-500/10 p-8 text-center">
          <h1 className="text-xl font-black text-white">Acesso restrito</h1>
          <p className="mt-2 text-sm text-sky-100/55">Administrador necessário.</p>
        </div>
      </div>
    );
  }

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0c2c] p-8 text-sm text-sky-100/55">
        Carregando inteligência comercial...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0c2c] p-5 text-white lg:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em]">Comercial</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            Inteligência Comercial
          </h1>
          <p className="mt-1 text-sm text-sky-100/55">
            Acompanhe vendas, rotas, cidades e desempenho comercial.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={limpar}
            className="rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
          >
            Limpar
          </button>

          <button
            onClick={carregar}
            className="rounded-xl border border-sky-300/30 bg-[#17345e] px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
          >
            Atualizar
          </button>
        </div>
      </div>

      {erro && (
        <div className="mb-5 rounded-2xl border border-red-300/25 bg-red-500/10 p-4 text-sm text-red-100">
          {erro}
        </div>
      )}

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <Card label="Passagens" valor={String(dados.passagens)} tom="blue" />
        <Card label="Faturamento" valor={moeda(dados.total)} tom="green" />
        <Card label="Ticket médio" valor={moeda(dados.ticket)} tom="amber" />
        <Card label="Cidades" valor={String(dados.cidades.length)} tom="purple" />
      </div>

      <section className="mb-6 rounded-3xl border border-[#7ba6d4]/25 bg-[#0f2240] p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-black uppercase tracking-wide text-white">
            Filtros comerciais
          </h2>
          <span className="rounded-full border border-[#7ba6d4]/25 bg-[#17345e] px-3 py-1 text-[10px] font-black uppercase text-sky-100/75">
            {filtradas.length} registros
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
          <Select
            value={filtros.mes}
            onChange={(v) => setFiltro("mes", v)}
            todos="Todos os meses"
            options={opcoes.meses.map((m) => ({ value: m, label: labelMes(m) }))}
          />

          <Select
            value={filtros.barco}
            onChange={(v) => setFiltro("barco", v)}
            todos="Todos os barcos"
            options={opcoes.barcos.map((b) => ({ value: b, label: b }))}
          />

          <Select
            value={filtros.rota}
            onChange={(v) => setFiltro("rota", v)}
            todos="Todas as rotas"
            options={opcoes.rotas.map((r) => ({ value: r, label: r }))}
          />

          <Select
            value={filtros.cidade}
            onChange={(v) => setFiltro("cidade", v)}
            todos="Todas as cidades"
            options={opcoes.cidades.map((c) => ({ value: c, label: c }))}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Ranking titulo="Cidades que compram" lista={dados.cidades} />
        <Ranking titulo="Rotas vendidas" lista={dados.rotas} />
        <Ranking titulo="Barcos" lista={dados.barcos} />
        <Ranking titulo="Usuários por cidade" lista={dados.usuariosPorCidade} />
      </div>
    </div>
  );
}
