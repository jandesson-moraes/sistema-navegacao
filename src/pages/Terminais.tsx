import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type Terminal = {
  id: string;
  nome?: string;
  cidade?: string;
  coordenadas?: {
    lat?: number;
    lng?: number;
  };
};

function numeroCoord(valor: string) {
  const n = Number(String(valor || "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function formatarCoord(valor: any) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return String(Number(n.toFixed(6)));
}

export default function Terminais() {
  const modal = useAppModal();

  const [terminais, setTerminais] = useState<Terminal[]>([]);
  const [novoNome, setNovoNome] = useState("");
  const [novaCidade, setNovaCidade] = useState("");
  const [novaLat, setNovaLat] = useState("");
  const [novaLng, setNovaLng] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");

  const [cidadesIbge, setCidadesIbge] = useState<string[]>([]);
  const [cidadesFiltradas, setCidadesFiltradas] = useState<string[]>([]);
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false);
  const [carregandoCidades, setCarregandoCidades] = useState(true);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "terminais"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as Terminal)
        .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || "")));

      setTerminais(lista);
    });

    fetch("https://servicodados.ibge.gov.br/api/v1/localidades/municipios")
      .then((response) => response.json())
      .then((data) => {
        const nomesFormatados = data.map((cidade: any) => {
          const uf = cidade.microrregiao?.mesorregiao?.UF?.sigla || "";
          return `${cidade.nome} - ${uf}`;
        });

        setCidadesIbge(nomesFormatados);
        setCarregandoCidades(false);
      })
      .catch((err) => {
        console.log("Erro API IBGE:", err);
        setCarregandoCidades(false);
      });

    return () => unsub();
  }, []);

  const terminaisFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    if (!texto) return terminais;

    return terminais.filter((porto) =>
      [porto.nome, porto.cidade, porto.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto),
    );
  }, [terminais, busca]);

  const resumo = useMemo(() => {
    const comCoordenada = terminais.filter(
      (porto) =>
        Number.isFinite(Number(porto.coordenadas?.lat)) &&
        Number.isFinite(Number(porto.coordenadas?.lng)),
    ).length;

    const cidades = new Set(terminais.map((porto) => porto.cidade).filter(Boolean));

    return {
      total: terminais.length,
      comCoordenada,
      cidades: cidades.size,
      editando: editandoId ? 1 : 0,
    };
  }, [terminais, editandoId]);

  const handleDigitacaoCidade = (texto: string) => {
    setNovaCidade(texto);

    if (texto.length > 2 && cidadesIbge.length > 0) {
      const resultados = cidadesIbge
        .filter((cidade) => cidade.toLowerCase().includes(texto.toLowerCase()))
        .slice(0, 6);

      setCidadesFiltradas(resultados);
      setMostrarSugestoes(true);
    } else {
      setMostrarSugestoes(false);
    }
  };

  const selecionarCidade = (cidadeEscolhida: string) => {
    setNovaCidade(cidadeEscolhida);
    setMostrarSugestoes(false);
  };

  const limparFormulario = () => {
    setNovoNome("");
    setNovaCidade("");
    setNovaLat("");
    setNovaLng("");
    setEditandoId(null);
    setMostrarSugestoes(false);
  };

  const salvarPorto = async () => {
    const lat = numeroCoord(novaLat);
    const lng = numeroCoord(novaLng);

    if (!novoNome.trim() || !novaCidade.trim() || lat === null || lng === null) {
      await modal.aviso(
        "Dados obrigatórios",
        "Preencha nome, cidade, latitude e longitude do terminal.",
      );
      return;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      await modal.aviso(
        "Coordenadas inválidas",
        "Latitude deve ficar entre -90 e 90. Longitude deve ficar entre -180 e 180.",
      );
      return;
    }

    const dados = {
      nome: novoNome.trim(),
      cidade: novaCidade.trim(),
      coordenadas: {
        lat,
        lng,
      },
    };

    setSalvando(true);

    try {
      if (editandoId) {
        await updateDoc(doc(db, "terminais", editandoId), dados);
        await modal.sucesso(
          "Terminal atualizado",
          "As alterações foram salvas com sucesso.",
        );
      } else {
        await addDoc(collection(db, "terminais"), dados);
        await modal.sucesso(
          "Terminal cadastrado",
          "O novo porto/terminal foi incluído no sistema.",
        );
      }

      limparFormulario();
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar terminal",
        error?.message || "Não foi possível salvar o terminal.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const prepararEdicao = (porto: Terminal) => {
    setNovoNome(porto.nome || "");
    setNovaCidade(porto.cidade || "");
    setNovaLat(porto.coordenadas?.lat !== undefined ? String(porto.coordenadas.lat) : "");
    setNovaLng(porto.coordenadas?.lng !== undefined ? String(porto.coordenadas.lng) : "");
    setEditandoId(porto.id);
    setMostrarSugestoes(false);
  };

  const apagarPorto = async (id: string) => {
    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Remover terminal?",
      mensagem: "Deseja remover este terminal da base de dados?",
      confirmarTexto: "Remover",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    try {
      await deleteDoc(doc(db, "terminais", id));
      await modal.sucesso("Terminal removido", "O terminal foi removido da base.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao remover terminal",
        error?.message || "Não foi possível remover o terminal.",
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#0d0c2c] p-5 text-white lg:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em]">
            Base operacional
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Portos e Terminais</h1>
          <p className="mt-1 text-sm text-sky-100/55">
            Cadastre pontos de parada com cidade e coordenadas oficiais.
          </p>
        </div>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar porto, terminal ou cidade..."
          className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 xl:w-[360px]"
        />
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <MiniResumo label="Terminais" valor={resumo.total} />
        <MiniResumo label="Com coordenada" valor={resumo.comCoordenada} />
        <MiniResumo label="Cidades" valor={resumo.cidades} />
        <MiniResumo label="Modo" valor={editandoId ? "Editando" : "Cadastro"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="rounded-3xl border border-[#7ba6d4]/25 bg-[#0f2240] p-5 shadow-sm">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">
                {editandoId ? "Editar terminal" : "Novo terminal"}
              </h2>
              <p className="mt-1 text-xs text-sky-100/55">
                Informe manualmente as coordenadas do ponto.
              </p>
            </div>

            {editandoId && (
              <button
                onClick={limparFormulario}
                className="rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] px-3 py-2 text-[10px] font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
              >
                Novo
              </button>
            )}
          </div>

          <div className="grid gap-4">
            <CampoTexto
              label="Nome do porto/terminal"
              value={novoNome}
              onChange={setNovoNome}
              placeholder="Ex: Porto DNIT Juruti"
            />

            <div className="relative">
              <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">
                Município
                {carregandoCidades && (
                  <span className="ml-2 text-[10px] font-bold normal-case text-sky-200/70">
                    sincronizando IBGE...
                  </span>
                )}
              </p>

              <input
                value={novaCidade}
                onChange={(e) => handleDigitacaoCidade(e.target.value)}
                disabled={carregandoCidades}
                placeholder={
                  carregandoCidades ? "Aguarde..." : "Digite a cidade. Ex: Juruti"
                }
                className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 disabled:cursor-not-allowed disabled:opacity-50"
              />

              {mostrarSugestoes && cidadesFiltradas.length > 0 && (
                <ul className="absolute z-50 mt-2 w-full overflow-hidden rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] shadow-2xl">
                  {cidadesFiltradas.map((cidade, index) => (
                    <li
                      key={index}
                      onClick={() => selecionarCidade(cidade)}
                      className="cursor-pointer border-b border-white/10 p-3 text-sm font-semibold text-sky-100 transition last:border-0 hover:bg-[#2b5b91]"
                    >
                      {cidade}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <CampoTexto
                label="Latitude"
                value={novaLat}
                onChange={setNovaLat}
                placeholder="Ex: -2.162"
                tipo="number"
              />

              <CampoTexto
                label="Longitude"
                value={novaLng}
                onChange={setNovaLng}
                placeholder="Ex: -56.095"
                tipo="number"
              />
            </div>

            <button
              onClick={salvarPorto}
              disabled={carregandoCidades || salvando}
              className={[
                "rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] transition disabled:opacity-60",
                editandoId
                  ? "border border-amber-300/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                  : "border border-emerald-300/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
              ].join(" ")}
            >
              {salvando
                ? "Salvando..."
                : editandoId
                  ? "Gravar alterações"
                  : "Cadastrar terminal"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-[#7ba6d4]/25 bg-[#0f2240] p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-black">Terminais cadastrados</h2>
              <p className="mt-1 text-xs text-sky-100/55">
                {terminaisFiltrados.length} resultado(s) encontrado(s).
              </p>
            </div>
          </div>

          {terminaisFiltrados.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#7ba6d4]/25 bg-[#143760] p-8 text-center text-sm text-sky-100/55">
              Nenhum terminal encontrado.
            </div>
          ) : (
            <div className="grid gap-3">
              {terminaisFiltrados.map((porto) => (
                <div
                  key={porto.id}
                  className="rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] p-4 transition hover:bg-[#17345e]"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-black text-white">
                        {porto.nome || "Terminal sem nome"}
                      </h3>
                      <p className="mt-1 text-xs font-semibold text-sky-100/55">
                        {porto.cidade || "Sem cidade"}
                      </p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => prepararEdicao(porto)}
                        className="rounded-xl border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-[10px] font-black uppercase text-sky-100 hover:bg-sky-300/20"
                      >
                        Editar
                      </button>

                      <button
                        onClick={() => apagarPorto(porto.id)}
                        className="rounded-xl border border-red-300/35 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-200 hover:bg-red-500/20"
                      >
                        Remover
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Mini
                      label="Latitude"
                      valor={formatarCoord(porto.coordenadas?.lat)}
                    />
                    <Mini
                      label="Longitude"
                      valor={formatarCoord(porto.coordenadas?.lng)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CampoTexto({
  label,
  value,
  onChange,
  placeholder,
  tipo = "text",
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  tipo?: string;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>
      <input
        type={tipo}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60"
      />
    </label>
  );
}

function Mini({ label, valor }: { label: string; valor: any }) {
  return (
    <div className="rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] p-3">
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-sky-100/55">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-black text-white">{valor}</p>
    </div>
  );
}

function MiniResumo({ label, valor }: { label: string; valor: any }) {
  return (
    <div className="rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-sky-100/55">
        {label}
      </p>
      <p className="mt-2 text-xl font-black text-white">{valor}</p>
    </div>
  );
}
