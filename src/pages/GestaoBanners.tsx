import React, { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { auth, db, storage } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type TipoCampanha = "promocao" | "aviso" | "informativo";
type PublicoAlvo = "todos" | "cidade" | "comprou_barco";
type MomentoExibicao = "agora" | "ao_abrir_app" | "apos_tempo";

type BannerForm = {
  titulo: string;
  subtitulo: string;
  mensagem: string;
  botaoTexto: string;
  linkDestino: string;
  tipo: TipoCampanha;
  publicoAlvo: PublicoAlvo;
  cidadeAlvo: string;
  barcoIdAlvo: string;
  momentoExibicao: MomentoExibicao;
  tempoDepoisSegundos: string;
  mostrarUmaVez: boolean;
  destaque: boolean;
  exibirComoPopup: boolean;
  ativo: boolean;
};

const FORM_INICIAL: BannerForm = {
  titulo: "",
  subtitulo: "",
  mensagem: "",
  botaoTexto: "Ver agora",
  linkDestino: "",
  tipo: "promocao",
  publicoAlvo: "todos",
  cidadeAlvo: "",
  barcoIdAlvo: "",
  momentoExibicao: "ao_abrir_app",
  tempoDepoisSegundos: "15",
  mostrarUmaVez: true,
  destaque: true,
  exibirComoPopup: true,
  ativo: true,
};

const TIPOS = {
  promocao: {
    label: "Promoção",
    tag: "Oferta",
    icone: "🔥",
    classe: "border-amber-300/25 bg-amber-400/10 text-amber-100",
  },
  aviso: {
    label: "Aviso",
    tag: "Aviso",
    icone: "🔔",
    classe: "border-sky-300/25 bg-sky-400/10 text-sky-100",
  },
  informativo: {
    label: "Informativo",
    tag: "Info",
    icone: "✨",
    classe: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
  },
};

const PUBLICOS = {
  todos: {
    label: "Todos os usuários",
    resumo: "Aparece para todos no app",
    chip: "Todos",
    icone: "🌎",
  },
  cidade: {
    label: "Usuários de uma cidade",
    resumo: "Filtra pela cidade do cadastro do usuário",
    chip: "Cidade",
    icone: "📍",
  },
  comprou_barco: {
    label: "Quem comprou passagem de um barco",
    resumo: "Filtra usuários com passagem desse barco",
    chip: "Comprou barco",
    icone: "🎟️",
  },
};

const MOMENTOS = {
  agora: {
    label: "Mostrar agora",
    resumo: "Prioridade máxima quando o app sincronizar",
    chip: "Agora",
  },
  ao_abrir_app: {
    label: "Ao abrir o app",
    resumo: "Aparece na entrada do usuário",
    chip: "Abertura",
  },
  apos_tempo: {
    label: "Depois de um tempo",
    resumo: "Aparece após alguns segundos de uso",
    chip: "Temporizado",
  },
};

function limparForm() {
  return { ...FORM_INICIAL };
}

function dataMs(valor: any) {
  if (!valor) return 0;
  if (typeof valor?.toDate === "function") return valor.toDate().getTime();

  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function formatarData(valor: any) {
  if (!valor) return "—";

  const data = typeof valor?.toDate === "function" ? valor.toDate() : new Date(valor);

  if (Number.isNaN(data.getTime())) return "—";

  return data.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizarCidade(valor: string) {
  return String(valor || "").trim();
}

function textoPublico(campanha: any) {
  const publico = campanha.publicoAlvo || campanha.publico || "todos";

  if (publico === "cidade") {
    return campanha.cidadeAlvo || "Cidade";
  }

  if (publico === "comprou_barco") {
    return campanha.barcoNomeAlvo || campanha.barcoIdAlvo || "Barco";
  }

  return "Todos";
}

export default function GestaoBanners() {
  const modal = useAppModal();

  const [banners, setBanners] = useState<any[]>([]);
  const [barcos, setBarcos] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [form, setForm] = useState<BannerForm>(FORM_INICIAL);
  const [imagemFile, setImagemFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imagemAtualUrl, setImagemAtualUrl] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "ativos" | "pausados">("todos");

  useEffect(() => {
    const q = query(collection(db, "banners_promocionais"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const lista = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a: any, b: any) => dataMs(b.createdAt) - dataMs(a.createdAt));

        setBanners(lista);
      },
      (error) => {
        console.error("Erro ao carregar banners:", error);
      },
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a: any, b: any) =>
          String(a.nome || a.id).localeCompare(String(b.nome || b.id), "pt-BR"),
        );

      setBarcos(lista);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "usuarios"),
      (snapshot) => {
        setUsuarios(
          snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
        );
      },
      () => {
        setUsuarios([]);
      },
    );

    return () => unsub();
  }, []);

  const cidades = useMemo(() => {
    const lista = usuarios
      .map((usuario) =>
        normalizarCidade(
          usuario.cidadeResidenciaCompleta ||
            (usuario.cidadeResidencia && usuario.estadoResidencia
              ? `${usuario.cidadeResidencia} - ${usuario.estadoResidencia}`
              : usuario.cidade || usuario.cidadeUsuario || ""),
        ),
      )
      .filter(Boolean);

    return Array.from(new Set(lista)).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [usuarios]);

  const bannersFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    return banners.filter((banner) => {
      if (filtro === "ativos" && banner.ativo === false) return false;
      if (filtro === "pausados" && banner.ativo !== false) return false;

      if (!texto) return true;

      return [
        banner.titulo,
        banner.subtitulo,
        banner.mensagem,
        banner.cidadeAlvo,
        banner.barcoIdAlvo,
        banner.barcoNomeAlvo,
        banner.publicoAlvo,
        banner.tipo,
        banner.momentoExibicao,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto);
    });
  }, [banners, busca, filtro]);

  const resumo = useMemo(() => {
    return {
      total: banners.length,
      ativos: banners.filter((b) => b.ativo !== false).length,
      cidades: banners.filter((b) => b.publicoAlvo === "cidade").length,
      comprouBarco: banners.filter((b) => b.publicoAlvo === "comprou_barco").length,
    };
  }, [banners]);

  const atualizarForm = <K extends keyof BannerForm>(campo: K, valor: BannerForm[K]) => {
    setForm((atual) => ({ ...atual, [campo]: valor }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      void modal.aviso("Arquivo inválido", "Selecione uma imagem para o banner.");
      return;
    }

    setImagemFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const validar = async () => {
    if (!auth.currentUser) {
      await modal.erro("Acesso negado", "Faça login novamente para publicar.");
      return false;
    }

    if (!form.titulo.trim()) {
      await modal.aviso("Título obrigatório", "Informe o título da campanha.");
      return false;
    }

    if (!form.mensagem.trim()) {
      await modal.aviso(
        "Mensagem obrigatória",
        "Informe a mensagem que será exibida no app.",
      );
      return false;
    }

    if (!imagemFile && !imagemAtualUrl) {
      await modal.aviso(
        "Arte obrigatória",
        "Selecione uma imagem vertical para o banner.",
      );
      return false;
    }

    if (form.publicoAlvo === "cidade" && !form.cidadeAlvo.trim()) {
      await modal.aviso(
        "Cidade obrigatória",
        "Informe ou selecione a cidade do público-alvo.",
      );
      return false;
    }

    if (form.publicoAlvo === "comprou_barco" && !form.barcoIdAlvo.trim()) {
      await modal.aviso(
        "Selecione o barco",
        "Para alcançar quem comprou passagem de um barco, selecione a embarcação.",
      );
      return false;
    }

    if (form.momentoExibicao === "apos_tempo") {
      const segundos = Number(form.tempoDepoisSegundos);

      if (!Number.isFinite(segundos) || segundos < 3 || segundos > 300) {
        await modal.aviso("Tempo inválido", "Informe um tempo entre 3 e 300 segundos.");
        return false;
      }
    }

    return true;
  };

  const salvarBanner = async () => {
    const valido = await validar();
    if (!valido) return;

    setCarregando(true);

    try {
      let downloadURL = imagemAtualUrl;

      if (imagemFile) {
        const nomeArquivo = `${Date.now()}_${imagemFile.name}`;
        const storageRef = ref(storage, `banners/${nomeArquivo}`);
        const snapshot = await uploadBytes(storageRef, imagemFile);
        downloadURL = await getDownloadURL(snapshot.ref);
      }

      const barcoSelecionado = barcos.find((b) => b.id === form.barcoIdAlvo);
      const publicoAlvo = form.publicoAlvo;
      const momentoExibicao = form.momentoExibicao;
      const tempoDepoisSegundos =
        momentoExibicao === "apos_tempo"
          ? Math.max(3, Math.min(300, Number(form.tempoDepoisSegundos) || 15))
          : 0;

      const dadosCampanha = {
        titulo: form.titulo.trim(),
        subtitulo: form.subtitulo.trim(),
        mensagem: form.mensagem.trim(),
        botaoTexto: form.botaoTexto.trim() || "Ver agora",
        imageUrl: downloadURL,
        imagemUrl: downloadURL,
        linkDestino: form.linkDestino.trim(),
        tipo: form.tipo,

        // Novo modelo de público-alvo.
        publicoAlvo,
        cidadeAlvo: publicoAlvo === "cidade" ? form.cidadeAlvo.trim() : "",
        cidadeAlvoNormalizada:
          publicoAlvo === "cidade" ? form.cidadeAlvo.trim().toLowerCase() : "",
        barcoIdAlvo: publicoAlvo === "comprou_barco" ? form.barcoIdAlvo.trim() : "",
        barcoNomeAlvo:
          publicoAlvo === "comprou_barco"
            ? String(barcoSelecionado?.nome || barcoSelecionado?.id || form.barcoIdAlvo)
            : "",

        // Compatibilidade com versões antigas da tela/app.
        publico:
          publicoAlvo === "todos"
            ? "todos"
            : publicoAlvo === "cidade"
              ? "cidade"
              : "comprou_barco",
        barcoId: publicoAlvo === "comprou_barco" ? form.barcoIdAlvo.trim() : "",
        barcoNome:
          publicoAlvo === "comprou_barco"
            ? String(barcoSelecionado?.nome || barcoSelecionado?.id || form.barcoIdAlvo)
            : "",

        // Regras modernas de exibição mobile.
        momentoExibicao,
        mostrarAgora: momentoExibicao === "agora",
        mostrarAoAbrirApp: momentoExibicao === "ao_abrir_app",
        mostrarDepoisDeTempo: momentoExibicao === "apos_tempo",
        tempoDepoisSegundos,
        mostrarUmaVez: form.mostrarUmaVez,

        ativo: form.ativo,
        destaque: form.destaque,
        exibirComoPopup: form.exibirComoPopup,
        exibicaoMobile: {
          formato: "banner_vertical",
          larguraRecomendada: 1080,
          alturaRecomendada: 1920,
          popup: form.exibirComoPopup,
          destaque: form.destaque,
          momentoExibicao,
          tempoDepoisSegundos,
          mostrarUmaVez: form.mostrarUmaVez,
        },
        criadoPor: auth.currentUser.email || "",
        atualizadoEm: serverTimestamp(),
      };

      if (editandoId) {
        await updateDoc(doc(db, "banners_promocionais", editandoId), dadosCampanha);
      } else {
        await addDoc(collection(db, "banners_promocionais"), {
          ...dadosCampanha,
          createdAt: serverTimestamp(),
        });
      }

      setForm(limparForm());
      setImagemFile(null);
      setPreviewUrl(null);
      setImagemAtualUrl("");
      setEditandoId(null);

      await modal.sucesso(
        editandoId ? "Campanha atualizada" : "Campanha publicada",
        PUBLICOS[publicoAlvo].label +
          " receberão a campanha conforme a regra de exibição.",
      );
    } catch (error: any) {
      await modal.erro(
        "Falha ao publicar",
        error?.message || "Não foi possível publicar a campanha.",
      );
    } finally {
      setCarregando(false);
    }
  };

  const editarBanner = (banner: any) => {
    setEditandoId(banner.id);
    setImagemFile(null);
    setImagemAtualUrl(banner.imageUrl || banner.imagemUrl || "");
    setPreviewUrl(banner.imageUrl || banner.imagemUrl || null);

    setForm({
      titulo: banner.titulo || "",
      subtitulo: banner.subtitulo || "",
      mensagem: banner.mensagem || "",
      botaoTexto: banner.botaoTexto || "Ver agora",
      linkDestino: banner.linkDestino || "",
      tipo: banner.tipo || "promocao",
      publicoAlvo: banner.publicoAlvo || banner.publico || "todos",
      cidadeAlvo: banner.cidadeAlvo || "",
      barcoIdAlvo: banner.barcoIdAlvo || banner.barcoId || "",
      momentoExibicao: banner.momentoExibicao || "ao_abrir_app",
      tempoDepoisSegundos: String(banner.tempoDepoisSegundos || "15"),
      mostrarUmaVez: banner.mostrarUmaVez !== false,
      destaque: banner.destaque !== false,
      exibirComoPopup: banner.exibirComoPopup !== false,
      ativo: banner.ativo !== false,
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelarEdicao = () => {
    setEditandoId(null);
    setForm(limparForm());
    setImagemFile(null);
    setImagemAtualUrl("");
    setPreviewUrl(null);
  };

  const mostrarAgora = async (banner: any) => {
    try {
      await updateDoc(doc(db, "banners_promocionais", banner.id), {
        ativo: true,
        momentoExibicao: "agora",
        mostrarAgora: true,
        mostrarAoAbrirApp: false,
        mostrarDepoisDeTempo: false,
        exibirComoPopup: true,
        disparoAgoraId: `${Date.now()}`,
        disparoAgoraAt: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });

      await modal.sucesso(
        "Campanha enviada agora",
        "A campanha foi ativada e disparada em tempo real para os apps abertos.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao enviar agora",
        error?.message || "Não foi possível disparar a campanha agora.",
      );
    }
  };

  const alternarStatus = async (banner: any) => {
    try {
      await updateDoc(doc(db, "banners_promocionais", banner.id), {
        ativo: banner.ativo === false,
        atualizadoEm: serverTimestamp(),
      });
    } catch (error: any) {
      await modal.erro(
        "Erro ao atualizar",
        error?.message || "Não foi possível alterar o status.",
      );
    }
  };

  const deletarBanner = async (banner: any) => {
    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Remover campanha?",
      mensagem: `Remover "${banner.titulo || "esta campanha"}" da rede?`,
      confirmarTexto: "Remover",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    try {
      await deleteDoc(doc(db, "banners_promocionais", banner.id));
    } catch (error: any) {
      await modal.erro(
        "Erro ao remover",
        error?.message || "Não foi possível remover a campanha.",
      );
    }
  };

  const tipoInfo = TIPOS[form.tipo];
  const publicoInfo = PUBLICOS[form.publicoAlvo];
  const momentoInfo = MOMENTOS[form.momentoExibicao];

  return (
    <div className="min-h-screen bg-[#0d0c2c] p-5 text-white lg:p-6">
      <header className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em] text-sky-300">
            Central de campanhas
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
            Campanhas Mobile
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-sky-100/55">
            Publique promoções e avisos por cidade, para todos ou para quem comprou
            passagem de um barco.
          </p>
        </div>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar campanha, cidade ou barco..."
          className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/35 focus:border-sky-300/60 xl:w-[360px]"
        />
      </header>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <MiniResumo label="Campanhas" valor={resumo.total} />
        <MiniResumo label="Ativas" valor={resumo.ativos} />
        <MiniResumo label="Por cidade" valor={resumo.cidades} />
        <MiniResumo label="Comprou barco" valor={resumo.comprouBarco} />
      </div>

      <main className="grid gap-5 xl:grid-cols-[440px_1fr]">
        <section className="rounded-[28px] border border-[#1d426b] bg-[#0f2240] p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-white">
                {editandoId ? "Editar campanha" : "Nova campanha"}
              </h2>
              <p className="mt-1 text-xs text-sky-100/55">
                Defina público, momento e visual mobile.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {editandoId && (
                <button
                  type="button"
                  onClick={cancelarEdicao}
                  className="rounded-full border border-[#7ba6d4]/25 bg-[#17345e] px-3 py-1 text-[10px] font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                >
                  Cancelar edição
                </button>
              )}

              <span
                className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${tipoInfo.classe}`}
              >
                {tipoInfo.icone} {tipoInfo.label}
              </span>
            </div>
          </div>

          <div className="mb-5 rounded-[32px] border border-[#7ba6d4]/25 bg-[#071a31] p-4">
            <div className="mx-auto w-full max-w-[230px] overflow-hidden rounded-[34px] border-[7px] border-[#020617] bg-[#020617] shadow-2xl">
              <div className="relative aspect-[9/18] overflow-hidden rounded-[27px] bg-gradient-to-br from-[#0f2240] to-[#143760]">
                <div className="absolute left-1/2 top-0 z-20 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-[#020617]" />

                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] text-2xl">
                      📱
                    </div>
                    <p className="text-[10px] font-black uppercase tracking-wide text-sky-100/45">
                      Preview mobile 1080x1920
                    </p>
                  </div>
                )}

                <div className="absolute inset-x-3 bottom-3 rounded-3xl border border-white/15 bg-[#020617]/72 p-4 shadow-2xl backdrop-blur-md">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[8px] font-black uppercase ${tipoInfo.classe}`}
                    >
                      {tipoInfo.tag}
                    </span>

                    <span className="rounded-full border border-sky-300/25 bg-sky-400/10 px-2 py-0.5 text-[8px] font-black uppercase text-sky-100">
                      {publicoInfo.chip}
                    </span>

                    <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[8px] font-black uppercase text-white">
                      {momentoInfo.chip}
                    </span>
                  </div>

                  <h3 className="line-clamp-2 text-sm font-black leading-4 text-white">
                    {form.titulo || "Título da campanha"}
                  </h3>

                  <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-sky-100/65">
                    {form.mensagem || "Mensagem resumida para o passageiro no app."}
                  </p>

                  <button className="mt-3 w-full rounded-2xl bg-white px-3 py-2 text-[9px] font-black uppercase text-[#0f2240]">
                    {form.botaoTexto || "Ver agora"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <label className="rounded-2xl border border-[#7ba6d4]/25 bg-[#143760] p-3">
              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-sky-100/55">
                Arte vertical
              </p>
              <input
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full text-[11px] text-sky-100/60 file:mr-3 file:rounded-xl file:border-0 file:bg-sky-400/15 file:px-4 file:py-2 file:text-[10px] file:font-black file:uppercase file:text-sky-100 hover:file:bg-sky-400/25"
              />
            </label>

            <Campo
              label="Título"
              value={form.titulo}
              onChange={(v) => atualizarForm("titulo", v)}
              placeholder="Ex: Promoção para Santarém"
            />

            <Campo
              label="Subtítulo"
              value={form.subtitulo}
              onChange={(v) => atualizarForm("subtitulo", v)}
              placeholder="Ex: Oferta especial de hoje"
            />

            <label>
              <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-sky-100/55">
                Mensagem no app
              </p>
              <textarea
                rows={3}
                value={form.mensagem}
                onChange={(e) => atualizarForm("mensagem", e.target.value)}
                placeholder="Escreva o aviso ou promoção que o passageiro verá..."
                className="w-full resize-none rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <Campo
                label="Texto do botão"
                value={form.botaoTexto}
                onChange={(v) => atualizarForm("botaoTexto", v)}
                placeholder="Comprar agora"
              />

              <Campo
                label="Link ou rota"
                value={form.linkDestino}
                onChange={(v) => atualizarForm("linkDestino", v)}
                placeholder="https://..."
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Tipo"
                value={form.tipo}
                onChange={(v) => atualizarForm("tipo", v as TipoCampanha)}
                options={[
                  ["promocao", "Promoção"],
                  ["aviso", "Aviso"],
                  ["informativo", "Informativo"],
                ]}
              />

              <Select
                label="Público-alvo"
                value={form.publicoAlvo}
                onChange={(v) => atualizarForm("publicoAlvo", v as PublicoAlvo)}
                options={[
                  ["todos", "Todos os usuários"],
                  ["cidade", "Usuários de uma cidade"],
                  ["comprou_barco", "Quem comprou passagem de um barco"],
                ]}
              />
            </div>

            <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <div className="flex items-start gap-3">
                <span className="text-xl">{publicoInfo.icone}</span>
                <div>
                  <p className="text-sm font-black text-white">{publicoInfo.label}</p>
                  <p className="mt-1 text-xs text-sky-100/55">{publicoInfo.resumo}</p>
                </div>
              </div>
            </div>

            {form.publicoAlvo === "cidade" && (
              <label>
                <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-sky-100/55">
                  Cidade do usuário
                </p>
                <input
                  value={form.cidadeAlvo}
                  onChange={(e) => atualizarForm("cidadeAlvo", e.target.value)}
                  list="cidades-campanha-mobile"
                  placeholder="Ex: Juruti - PA"
                  className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
                />
                <datalist id="cidades-campanha-mobile">
                  {cidades.map((cidade) => (
                    <option key={cidade} value={cidade} />
                  ))}
                </datalist>
              </label>
            )}

            {form.publicoAlvo === "comprou_barco" && (
              <Select
                label="Passageiros que compraram passagem do barco"
                value={form.barcoIdAlvo}
                onChange={(v) => atualizarForm("barcoIdAlvo", v)}
                options={[
                  ["", "Selecione o barco"],
                  ...barcos.map(
                    (barco) => [barco.id, barco.nome || barco.id] as [string, string],
                  ),
                ]}
              />
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <Select
                label="Quando mostrar"
                value={form.momentoExibicao}
                onChange={(v) => atualizarForm("momentoExibicao", v as MomentoExibicao)}
                options={[
                  ["agora", "Mostrar agora"],
                  ["ao_abrir_app", "Ao abrir o app"],
                  ["apos_tempo", "Depois de alguns segundos"],
                ]}
              />

              {form.momentoExibicao === "apos_tempo" ? (
                <Campo
                  label="Tempo em segundos"
                  value={form.tempoDepoisSegundos}
                  onChange={(v) => atualizarForm("tempoDepoisSegundos", v)}
                  placeholder="15"
                />
              ) : (
                <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
                  <p className="text-[10px] font-black uppercase tracking-wide text-sky-100/55">
                    Regra
                  </p>
                  <p className="mt-1 text-sm font-black text-white">
                    {momentoInfo.label}
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#7ba6d4]/20 bg-[#143760] p-3">
              <p className="text-sm font-black text-white">{momentoInfo.label}</p>
              <p className="mt-1 text-xs text-sky-100/55">{momentoInfo.resumo}</p>
            </div>

            <div className="grid gap-2 md:grid-cols-4">
              <Toggle
                label="Ativo"
                checked={form.ativo}
                onChange={(v) => atualizarForm("ativo", v)}
              />
              <Toggle
                label="Popup"
                checked={form.exibirComoPopup}
                onChange={(v) => atualizarForm("exibirComoPopup", v)}
              />
              <Toggle
                label="Destaque"
                checked={form.destaque}
                onChange={(v) => atualizarForm("destaque", v)}
              />
              <Toggle
                label="Uma vez"
                checked={form.mostrarUmaVez}
                onChange={(v) => atualizarForm("mostrarUmaVez", v)}
              />
            </div>

            <button
              onClick={salvarBanner}
              disabled={carregando}
              className="rounded-2xl border border-sky-300/30 bg-[#2b5b91] px-5 py-4 text-xs font-black uppercase tracking-[0.16em] text-white shadow-lg shadow-black/20 transition hover:bg-[#346aa3] disabled:opacity-60"
            >
              {carregando
                ? "Salvando..."
                : editandoId
                  ? "Salvar alterações"
                  : "Publicar campanha"}
            </button>
          </div>
        </section>

        <section className="min-h-0 rounded-[28px] border border-[#1d426b] bg-[#0f2240] p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-black text-white">Campanhas publicadas</h2>
              <p className="mt-1 text-xs text-sky-100/55">
                Controle o que aparece no app do passageiro.
              </p>
            </div>

            <div className="flex gap-2">
              {[
                ["todos", "Todos"],
                ["ativos", "Ativos"],
                ["pausados", "Pausados"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setFiltro(id as any)}
                  className={[
                    "rounded-xl border px-3 py-2 text-[10px] font-black uppercase transition",
                    filtro === id
                      ? "border-sky-300/35 bg-sky-400/15 text-sky-100"
                      : "border-[#7ba6d4]/20 bg-[#17345e] text-sky-100/60 hover:bg-[#2b5b91]",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {bannersFiltrados.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#7ba6d4]/25 bg-[#143760] p-10 text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl border border-[#7ba6d4]/25 bg-[#17345e] text-3xl">
                📣
              </div>
              <p className="text-sm font-black text-white">Nenhuma campanha encontrada</p>
              <p className="mt-1 text-xs text-sky-100/55">
                Publique uma promoção ou aviso para começar.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {bannersFiltrados.map((banner) => {
                const tipo = (banner.tipo || "promocao") as TipoCampanha;
                const tipoInfo = TIPOS[tipo] || TIPOS.promocao;
                const momento = (banner.momentoExibicao ||
                  "ao_abrir_app") as MomentoExibicao;
                const momentoBanner = MOMENTOS[momento] || MOMENTOS.ao_abrir_app;

                return (
                  <article
                    key={banner.id}
                    className="group overflow-hidden rounded-[28px] border border-[#7ba6d4]/20 bg-[#143760] shadow-sm transition hover:-translate-y-1 hover:border-sky-300/35"
                  >
                    <div className="relative aspect-[9/13] overflow-hidden bg-[#071a31]">
                      {banner.imageUrl || banner.imagemUrl ? (
                        <img
                          src={banner.imageUrl || banner.imagemUrl}
                          alt={banner.titulo}
                          className={[
                            "h-full w-full object-cover transition duration-500 group-hover:scale-105",
                            banner.ativo === false ? "grayscale opacity-40" : "",
                          ].join(" ")}
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-4xl opacity-30">
                          📱
                        </div>
                      )}

                      <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-[#020617]/20 to-transparent" />

                      <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${tipoInfo.classe}`}
                        >
                          {tipoInfo.icone} {tipoInfo.label}
                        </span>

                        <span className="rounded-full border border-white/15 bg-[#020617]/55 px-2.5 py-1 text-[9px] font-black uppercase text-white backdrop-blur">
                          {textoPublico(banner)}
                        </span>

                        <span className="rounded-full border border-sky-300/25 bg-sky-400/10 px-2.5 py-1 text-[9px] font-black uppercase text-sky-100 backdrop-blur">
                          {momentoBanner.chip}
                        </span>
                      </div>

                      <div className="absolute right-3 top-3 flex flex-col gap-2 opacity-0 transition group-hover:opacity-100">
                        <button
                          onClick={() => mostrarAgora(banner)}
                          className="rounded-xl border border-emerald-300/30 bg-emerald-500/20 px-3 py-2 text-[10px] font-black uppercase text-emerald-100 backdrop-blur transition hover:bg-emerald-500/30"
                        >
                          Mostrar agora
                        </button>

                        <button
                          onClick={() => editarBanner(banner)}
                          className="rounded-xl border border-sky-300/30 bg-sky-400/15 px-3 py-2 text-[10px] font-black uppercase text-sky-100 backdrop-blur transition hover:bg-sky-400/25"
                        >
                          Editar
                        </button>

                        <button
                          onClick={() => alternarStatus(banner)}
                          className="rounded-xl border border-white/15 bg-[#020617]/65 px-3 py-2 text-[10px] font-black uppercase text-white backdrop-blur transition hover:bg-[#2b5b91]"
                        >
                          {banner.ativo === false ? "Ativar" : "Pausar"}
                        </button>

                        <button
                          onClick={() => deletarBanner(banner)}
                          className="rounded-xl border border-red-300/30 bg-red-500/15 px-3 py-2 text-[10px] font-black uppercase text-red-100 backdrop-blur transition hover:bg-red-500/25"
                        >
                          Remover
                        </button>
                      </div>

                      <div className="absolute inset-x-0 bottom-0 p-4">
                        <span
                          className={[
                            "mb-2 inline-flex rounded-full border px-2.5 py-1 text-[9px] font-black uppercase",
                            banner.ativo === false
                              ? "border-slate-300/20 bg-slate-400/10 text-slate-300"
                              : "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
                          ].join(" ")}
                        >
                          {banner.ativo === false ? "Pausado" : "Publicado"}
                        </span>

                        <h3 className="line-clamp-2 text-base font-black leading-5 text-white">
                          {banner.titulo}
                        </h3>

                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-sky-100/65">
                          {banner.mensagem || banner.subtitulo || "Sem mensagem"}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 p-3">
                      <Mini
                        label="Popup"
                        valor={banner.exibirComoPopup === false ? "Não" : "Sim"}
                      />
                      <Mini
                        label="Uma vez"
                        valor={banner.mostrarUmaVez === false ? "Não" : "Sim"}
                      />
                      <Mini
                        label="Disparo"
                        valor={banner.disparoAgoraId ? "Agora" : "—"}
                      />
                      <Mini label="Criado" valor={formatarData(banner.createdAt)} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-sky-100/55">
        {label}
      </p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-sky-100/35 focus:border-sky-300/60"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  options: [string, string][];
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase tracking-wide text-sky-100/55">
        {label}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white outline-none focus:border-sky-300/60"
      >
        {options.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={[
        "rounded-2xl border px-3 py-3 text-left transition",
        checked ? "border-sky-300/30 bg-sky-400/15" : "border-[#7ba6d4]/20 bg-[#17345e]",
      ].join(" ")}
    >
      <p className="text-[10px] font-black uppercase tracking-wide text-sky-100/55">
        {label}
      </p>
      <p className="mt-1 text-sm font-black text-white">{checked ? "Sim" : "Não"}</p>
    </button>
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

function Mini({ label, valor }: { label: string; valor: any }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#7ba6d4]/20 bg-[#17345e] p-2.5">
      <p className="text-[8px] font-black uppercase tracking-wide text-sky-100/45">
        {label}
      </p>
      <p className="mt-1 truncate text-[11px] font-black text-white">{valor}</p>
    </div>
  );
}
