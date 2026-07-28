import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";
import {
  ROTULOS_PLANO,
  planoEfetivo,
  statusSinal,
  type PlanoEmbarcacao,
  type StatusPlano,
} from "../domain/planos";
import {TIPOS_EMBARCACAO} from "../domain/tiposEmbarcacao";

type Embarcacao = {
  id: string;
  nome?: string;
  tipo?: string;
  tipoBarco?: string;
  categoria?: string;
  categoriaPlano?: string;
  planoSistema?: string;
  planoId?: PlanoEmbarcacao;
  planoStatus?: StatusPlano;
  planoValidoAte?: any;
  statusCadastro?: string;
  statusPublicacao?: string;
  status?: string;
  online?: boolean;
  ativo?: boolean;
  visivelNoApp?: boolean;
  icon?: string;
  ownerId?: string;
  ownerEmail?: string;
  emailDono?: string;
  donoNome?: string;
  tipoUsuario?: string;
  rastreadorDeviceId?: string;
  rastreadorAtivo?: boolean;
  nomeNaRede?: string;
  descricao?: string;
  fotos?: string[];
  foto?: string;
  fotoUrl?: string;
  instagramBarco?: string;
  facebookBarco?: string;
  siteBarco?: string;
  contatosWhatsApp?: Array<{numero?: string; nome?: string; mensagem?: string; ativo?: boolean}>;
  statusInstalacaoGps?: string;
  observacoesInstalacaoGps?: string;
  ultima_posicao?: {
    latitude?: number;
    longitude?: number;
    velocidade?: number;
  };
};

type Rastreador = {
  id: string;
  deviceId?: string;
  barcoId?: string;
  barcoIdAdmin?: string;
  embarcacaoNome?: string;
  nomeNaRede?: string;
  wifiNome?: string;
  wifiSSIDAtual?: string;
  status?: string;
};

type FormularioEmbarcacao = {
  idBarco: string;
  nomeBarco: string;
  senhaComandante: string;
  tipoBarco: string;
  categoriaPlano: string;
  planoId: PlanoEmbarcacao;
  planoStatus: StatusPlano;
  planoValidoAte: string;
  donoNome: string;
  donoEmail: string;
  ownerId: string;
  tipoUsuario: string;
  rastreadorDeviceId: string;
  nomeNaRede: string;
  ativarGps: boolean;
  descricao: string;
  fotosTexto: string;
  contato1: string;
  contato2: string;
  contato3: string;
  instagramBarco: string;
  facebookBarco: string;
  siteBarco: string;
  statusInstalacaoGps: string;
  observacoesInstalacaoGps: string;
};

const TIPOS_BARCO = [...TIPOS_EMBARCACAO];

const PLANOS = [
  { value: "basico", label: "Básico — gratuito" },
  { value: "vitrine", label: "Vitrine Digital — R$ 99,90/mês" },
  { value: "tempo_real", label: "Vitrine + Tempo Real — R$ 299,90/mês" },
] as const;
const STATUS_PLANOS: StatusPlano[] = [
  "ativo",
  "cortesia",
  "vencido",
  "suspenso",
  "cancelado",
];
const TIPOS_USUARIO = ["dono"];

const FORM_PADRAO: FormularioEmbarcacao = {
  idBarco: "",
  nomeBarco: "",
  senhaComandante: "",
  tipoBarco: "Barco regional",
  categoriaPlano: "GPS",
  planoId: "tempo_real",
  planoStatus: "ativo",
  planoValidoAte: "",
  donoNome: "",
  donoEmail: "",
  ownerId: "",
  tipoUsuario: "dono",
  rastreadorDeviceId: "",
  nomeNaRede: "",
  ativarGps: true,
  descricao: "",
  fotosTexto: "",
  contato1: "",
  contato2: "",
  contato3: "",
  instagramBarco: "",
  facebookBarco: "",
  siteBarco: "",
  statusInstalacaoGps: "aguardando_contato",
  observacoesInstalacaoGps: "",
};

function normalizarId(valor: string) {
  return String(valor || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 70);
}

function normalizarEmail(email: string) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function ownerIdAutomatico(email: string) {
  const emailNormalizado = normalizarEmail(email);
  if (!emailNormalizado) return "";

  return emailNormalizado.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function categoriaLegadaDoPlano(plano: PlanoEmbarcacao) {
  if (plano === "basico") return "Básico";
  if (plano === "vitrine") return "Vitrine";
  return "GPS";
}

function formatarCoord(valor: any) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "—";
  return String(Number(n.toFixed(6)));
}

function tipoEmbarcacao(barco: Embarcacao) {
  return barco.tipoBarco || barco.tipo || "Sem tipo";
}

function categoriaEmbarcacao(barco: Embarcacao) {
  return ROTULOS_PLANO[planoEfetivo(barco)];
}

function dataParaInput(valor: any) {
  if (!valor) return "";
  const data =
    typeof valor?.toDate === "function" ? valor.toDate() : new Date(String(valor));
  if (Number.isNaN(data.getTime())) return "";
  return data.toISOString().slice(0, 10);
}

function formularioDoBarco(barco: Embarcacao): FormularioEmbarcacao {
  const contatos = Array.isArray(barco.contatosWhatsApp)
    ? barco.contatosWhatsApp.filter((item) => item?.ativo !== false)
    : [];
  return {
    idBarco: barco.id || "",
    nomeBarco: barco.nome || "",
    senhaComandante: "",
    tipoBarco:
      tipoEmbarcacao(barco) === "Sem tipo" ? "Barco regional" : tipoEmbarcacao(barco),
    categoriaPlano: categoriaEmbarcacao(barco),
    planoId: planoEfetivo(barco),
    planoStatus: barco.planoStatus || "ativo",
    planoValidoAte: dataParaInput(barco.planoValidoAte),
    donoNome: barco.donoNome || "",
    donoEmail: barco.ownerEmail || barco.emailDono || "",
    ownerId:
      barco.ownerId || ownerIdAutomatico(barco.ownerEmail || barco.emailDono || ""),
    tipoUsuario: barco.tipoUsuario || "dono",
    rastreadorDeviceId: barco.rastreadorDeviceId || "",
    nomeNaRede: barco.nomeNaRede || `CMB_${barco.id}`,
    ativarGps: barco.rastreadorAtivo !== false,
    descricao: barco.descricao || "",
    fotosTexto: Array.isArray(barco.fotos) ? barco.fotos.join("\n") : "",
    contato1: contatos[0]?.numero || "",
    contato2: contatos[1]?.numero || "",
    contato3: contatos[2]?.numero || "",
    instagramBarco: barco.instagramBarco || "",
    facebookBarco: barco.facebookBarco || "",
    siteBarco: barco.siteBarco || "",
    statusInstalacaoGps: barco.statusInstalacaoGps || "aguardando_contato",
    observacoesInstalacaoGps: barco.observacoesInstalacaoGps || "",
  };
}

export default function Embarcacoes() {
  const modal = useAppModal();

  const [barcos, setBarcos] = useState<Embarcacao[]>([]);
  const [rastreadores, setRastreadores] = useState<Rastreador[]>([]);
  const [form, setForm] = useState<FormularioEmbarcacao>(FORM_PADRAO);
  const [mostrarSenhaCadastro, setMostrarSenhaCadastro] = useState(false);
  const [mostrarSenhaEdicao, setMostrarSenhaEdicao] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormularioEmbarcacao>(FORM_PADRAO);
  const [buscandoSenha, setBuscandoSenha] = useState(false);
  const barcoEmEdicao = useMemo(
    () => barcos.find((barco) => barco.id === editandoId) || null,
    [barcos, editandoId],
  );

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "embarcacoes"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as Embarcacao)
        .sort((a, b) => String(a.nome || a.id).localeCompare(String(b.nome || b.id)));

      setBarcos(lista);
      setCarregando(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "rastreadores"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as Rastreador)
        .sort((a, b) =>
          String(a.barcoIdAdmin || a.barcoId || a.deviceId || a.id).localeCompare(
            String(b.barcoIdAdmin || b.barcoId || b.deviceId || b.id),
          ),
        );

      setRastreadores(lista);
    });

    return () => unsub();
  }, []);

  const barcosFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();
    if (!texto) return barcos;

    return barcos.filter((barco) =>
      [
        barco.id,
        barco.nome,
        tipoEmbarcacao(barco),
        categoriaEmbarcacao(barco),
        barco.status,
        barco.ownerEmail,
        barco.emailDono,
        barco.ownerId,
        barco.rastreadorDeviceId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(texto),
    );
  }, [barcos, busca]);

  const resumo = useMemo(() => {
    return {
      total: barcos.length,
      online: barcos.filter((barco) => barco.online === true).length,
      comGps: barcos.filter(
        (barco) => barco.rastreadorDeviceId || barco.rastreadorAtivo === true,
      ).length,
      completos: barcos.filter((barco) => planoEfetivo(barco) === "tempo_real")
        .length,
    };
  }, [barcos]);

  const rastreadoresDisponiveis = useMemo(() => {
    const idAtual = normalizarId(form.idBarco);

    return rastreadores.filter((rastreador) => {
      const vinculo = rastreador.barcoIdAdmin || rastreador.barcoId;
      return !vinculo || vinculo === "SEM_BARCO" || vinculo === idAtual;
    });
  }, [rastreadores, form.idBarco]);

  function alterarForm(campo: keyof FormularioEmbarcacao, valor: any) {
    setForm((atual) => {
      const novo = { ...atual, [campo]: valor };

      if (campo === "donoEmail" && !atual.ownerId.trim()) {
        novo.ownerId = ownerIdAutomatico(valor);
      }

      if (campo === "idBarco" && !atual.nomeNaRede.trim()) {
        novo.nomeNaRede = `CMB_${normalizarId(valor)}`;
      }

      if (campo === "planoId") {
        novo.categoriaPlano = categoriaLegadaDoPlano(valor);
        if (valor === "basico") novo.planoValidoAte = "";
      }

      return novo;
    });
  }

  function alterarEditForm(campo: keyof FormularioEmbarcacao, valor: any) {
    setEditForm((atual) => {
      const novo = { ...atual, [campo]: valor };

      if (campo === "donoEmail" && !atual.ownerId.trim()) {
        novo.ownerId = ownerIdAutomatico(valor);
      }

      if (campo === "idBarco" && !atual.nomeNaRede.trim()) {
        novo.nomeNaRede = `CMB_${normalizarId(valor)}`;
      }

      if (campo === "planoId") {
        novo.categoriaPlano = categoriaLegadaDoPlano(valor);
        if (valor === "basico") novo.planoValidoAte = "";
      }

      return novo;
    });
  }

  function limparCadastro() {
    setForm(FORM_PADRAO);
    setMostrarSenhaCadastro(false);
  }

  function cancelarEdicao() {
    setEditandoId(null);
    setEditForm(FORM_PADRAO);
    setMostrarSenhaEdicao(false);
  }

  function validarFormulario(dados: FormularioEmbarcacao) {
    const id = normalizarId(dados.idBarco);
    const nome = dados.nomeBarco.trim();
    const senha = dados.senhaComandante.trim();
    const emailDono = normalizarEmail(dados.donoEmail);
    const ownerId = dados.ownerId.trim() || ownerIdAutomatico(emailDono);

    if (!id || !nome || !senha) {
      return "Preencha o ID do barco, o nome da embarcação e a senha do comandante.";
    }

    if (!emailDono || !ownerId) {
      return "Informe o e-mail do dono. O sistema usa esse dado para criar o vínculo da embarcação.";
    }

    return "";
  }

  function montarEmbarcacaoPayload(
    dados: FormularioEmbarcacao,
    embarcacaoAnterior: Partial<Embarcacao> = {},
  ) {
    const id = normalizarId(dados.idBarco);
    const emailDono = normalizarEmail(dados.donoEmail);
    const ownerId = dados.ownerId.trim() || ownerIdAutomatico(emailDono);
    const deviceId = dados.rastreadorDeviceId.trim();
    const nomeNaRede = dados.nomeNaRede.trim() || `CMB_${id}`;
    const fotos = dados.fotosTexto.split(/\r?\n/)
      .map((item) => item.trim()).filter(Boolean).slice(0, 5);
    const limiteContatos = dados.planoId === "tempo_real" ? 3 :
      dados.planoId === "vitrine" ? 1 : 0;
    const contatosWhatsApp = [dados.contato1, dados.contato2, dados.contato3]
      .map((numero, indice) => ({
        id: `contato_${indice + 1}`,
        numero: numero.replace(/\D/g, ""),
        nome: "",
        ativo: true,
        mensagem: `Olá! Vim pelo app Cadê Meu Barco e gostaria de informações sobre ${dados.nomeBarco.trim()}.`,
      }))
      .filter((item) => item.numero.length >= 10)
      .slice(0, limiteContatos);

    return {
      ...embarcacaoAnterior,
      id,
      nome: dados.nomeBarco.trim(),
      tipo: dados.tipoBarco,
      tipoBarco: dados.tipoBarco,
      categoria: dados.categoriaPlano,
      categoriaPlano: dados.categoriaPlano,
      planoSistema: dados.categoriaPlano,
      planoId: dados.planoId,
      planoStatus: dados.planoStatus,
      planoValidoAte: dados.planoValidoAte
        ? new Date(`${dados.planoValidoAte}T23:59:59.999`)
        : null,
      planoEfetivoId: planoEfetivo({
        planoId: dados.planoId,
        planoStatus: dados.planoStatus,
        planoValidoAte: dados.planoValidoAte
          ? new Date(`${dados.planoValidoAte}T23:59:59.999`)
          : null,
      }),
      planoVersao: 1,
      statusCadastro: embarcacaoAnterior.statusCadastro || "aprovado",
      statusPublicacao: embarcacaoAnterior.statusPublicacao || "publicado",
      donoNome: dados.donoNome.trim(),
      emailDono,
      ownerEmail: emailDono,
      ownerId,
      tipoUsuario: dados.tipoUsuario || "dono",
      rastreadorDeviceId: deviceId,
      rastreadorAtivo: dados.ativarGps,
      nomeNaRede,
      descricao: dados.descricao.trim(),
      fotos,
      foto: fotos[0] || embarcacaoAnterior.foto || "",
      fotoUrl: fotos[0] || embarcacaoAnterior.fotoUrl || "",
      contatosWhatsApp,
      informacoesPassageiroAtivo: limiteContatos > 0 && contatosWhatsApp.length > 0,
      whatsappInformacoes: contatosWhatsApp[0]?.numero || "",
      instagramBarco: dados.planoId === "basico" ? "" : dados.instagramBarco.trim(),
      facebookBarco: dados.planoId === "basico" ? "" : dados.facebookBarco.trim(),
      siteBarco: dados.planoId === "basico" ? "" : dados.siteBarco.trim(),
      statusInstalacaoGps: dados.planoId === "tempo_real"
        ? dados.statusInstalacaoGps : "nao_aplicavel",
      observacoesInstalacaoGps: dados.planoId === "tempo_real"
        ? dados.observacoesInstalacaoGps.trim() : "",
      ultima_posicao: embarcacaoAnterior.ultima_posicao || {
        latitude: 0,
        longitude: 0,
        velocidade: 0,
      },
      ultima_atualizacao:
        embarcacaoAnterior.ultima_atualizacao || new Date().toISOString(),
      status: embarcacaoAnterior.status || "ativo",
      online: embarcacaoAnterior.online === true,
      ativo: true,
      // Embarcações antigas sem este campo continuam visíveis por padrão.
      visivelNoApp: embarcacaoAnterior.visivelNoApp !== false,
      icon: embarcacaoAnterior.icon || "🚢",
      atualizadoEm: serverTimestamp(),
    };
  }

  async function salvarVinculos(dados: FormularioEmbarcacao) {
    const id = normalizarId(dados.idBarco);
    const emailDono = normalizarEmail(dados.donoEmail);
    const ownerId = dados.ownerId.trim() || ownerIdAutomatico(emailDono);
    const deviceId = dados.rastreadorDeviceId.trim();
    const nomeNaRede = dados.nomeNaRede.trim() || `CMB_${id}`;

    await setDoc(
      doc(db, "acessos_comandantes", id),
      {
        id,
        barcoId: id,
        nomeBarco: dados.nomeBarco.trim(),
        tipoBarco: dados.tipoBarco,
        categoriaPlano: dados.categoriaPlano,
        planoId: dados.planoId,
        nomeComandante: `Comandante ${dados.nomeBarco.trim()}`,
        senha: dados.senhaComandante.trim(),
        ativo: true,
        atualizadoEm: serverTimestamp(),
      },
      { merge: true },
    );

    await setDoc(
      doc(db, "usuarios", ownerId),
      {
        uid: ownerId,
        ownerId,
        nome: dados.donoNome.trim() || emailDono || ownerId,
        email: emailDono,
        tipo: dados.tipoUsuario || "dono",
        tipoUsuario: dados.tipoUsuario || "dono",
        ativo: true,
        atualizadoEm: serverTimestamp(),
        criadoEm: serverTimestamp(),
      },
      { merge: true },
    );

    if (deviceId) {
      await setDoc(
        doc(db, "rastreadores", deviceId),
        {
          id: deviceId,
          deviceId,
          barcoId: id,
          barcoIdAdmin: id,
          embarcacaoNome: dados.nomeBarco.trim(),
          ownerId,
          ownerEmail: emailDono,
          nomeNaRede,
          ativo: dados.ativarGps,
          rastreadorAtivoRemoto: dados.ativarGps,
          precisaProvisionar: false,
          atualizadoPeloSistemaEm: new Date().toISOString(),
          atualizadoEm: serverTimestamp(),
        },
        { merge: true },
      );
    }
  }

  async function cadastrarBarco() {
    const erro = validarFormulario(form);

    if (erro) {
      await modal.aviso("Dados obrigatórios", erro);
      return;
    }

    setSalvando(true);

    try {
      const id = normalizarId(form.idBarco);

      await setDoc(
        doc(db, "embarcacoes", id),
        {
          ...montarEmbarcacaoPayload(form),
          criadoEm: serverTimestamp(),
        },
        { merge: true },
      );

      await salvarVinculos(form);
      limparCadastro();

      await modal.sucesso(
        "Cadastro unificado salvo",
        "A embarcação, o dono, o acesso do comandante e o GPS foram conectados.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar",
        error?.message || "Não foi possível salvar a embarcação.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function alterarVisibilidadeNoApp(barco: Embarcacao) {
    const estaVisivel = barco.visivelNoApp !== false;

    const confirmou = await modal.confirmar({
      tipo: estaVisivel ? "warning" : "confirm",
      titulo: estaVisivel
        ? "Ocultar embarcação do aplicativo?"
        : "Publicar embarcação no aplicativo?",
      mensagem: estaVisivel
        ? `A embarcação ${barco.nome || barco.id} deixará de aparecer no aplicativo. Os dados, o GPS e o histórico serão mantidos.`
        : `A embarcação ${barco.nome || barco.id} voltará à pesquisa. Somente o plano Tempo Real poderá aparecer como posição no mapa.`,
      confirmarTexto: estaVisivel ? "Ocultar do app" : "Publicar no app",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;

    try {
      await setDoc(
        doc(db, "embarcacoes", barco.id),
        {
          visivelNoApp: !estaVisivel,
          visibilidadeAtualizadaEm: serverTimestamp(),
        },
        { merge: true },
      );

      await modal.sucesso(
        estaVisivel ? "Embarcação ocultada" : "Embarcação publicada",
        estaVisivel
          ? "Ela não aparecerá mais no aplicativo, mas todos os dados continuam salvos."
          : "Ela já pode aparecer novamente na pesquisa e no mapa do aplicativo.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao alterar visibilidade",
        error?.message || "Não foi possível atualizar a exibição da embarcação.",
      );
    }
  }

  async function excluirBarco(id: string) {
    const confirmou = await modal.confirmar({
      tipo: "warning",
      titulo: "Remover embarcação?",
      mensagem:
        "Esta ação removerá a embarcação e os dados operacionais vinculados: programações, grades, rotas, banners e acessos. O histórico financeiro não será apagado.",
      confirmarTexto: "Continuar",
      cancelarTexto: "Cancelar",
    });

    if (!confirmou) return;
    const digitado = window.prompt(
      `Para confirmar a exclusão completa, digite exatamente o ID:\n${id}`,
    );
    if (digitado !== id) {
      await modal.aviso(
        "Exclusão cancelada",
        "O ID digitado não corresponde à embarcação.",
      );
      return;
    }

    setSalvando(true);
    try {
      const referencias = [
        {colecao: "programacoes_viagem", campo: "barcoId"},
        {colecao: "programacoes_viagem", campo: "embarcacaoId"},
        {colecao: "grades_viagens", campo: "id_barco"},
        {colecao: "grades_viagens", campo: "barcoId"},
        {colecao: "rotas_historicas", campo: "barcoId"},
        {colecao: "banners_promocionais", campo: "barcoId"},
        {colecao: "acessos_comandantes", campo: "barcoId"},
      ];
      const removidas = new Set<string>();
      for (const referencia of referencias) {
        const encontrados = await getDocs(query(
          collection(db, referencia.colecao),
          where(referencia.campo, "==", id),
        ));
        for (const item of encontrados.docs) {
          const chave = `${referencia.colecao}/${item.id}`;
          if (!removidas.has(chave)) {
            await deleteDoc(item.ref);
            removidas.add(chave);
          }
        }
      }

      const rastreadoresVinculados = await getDocs(query(
        collection(db, "rastreadores"),
        where("barcoId", "==", id),
      ));
      for (const item of rastreadoresVinculados.docs) {
        await setDoc(item.ref, {
          barcoId: "",
          barcoIdAdmin: "",
          embarcacaoNome: "",
          rastreadorAtivoRemoto: false,
          precisaProvisionar: true,
          atualizadoEm: serverTimestamp(),
        }, {merge: true});
      }

      await deleteDoc(doc(db, "embarcacoes", id));
      await deleteDoc(doc(db, "acessos_comandantes", id));

      await modal.sucesso(
        "Embarcação e dados removidos",
        "Os dados operacionais foram excluídos. Rastreadores físicos foram desvinculados e preservados para reutilização.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao remover",
        error?.message || "Não foi possível remover a embarcação.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function iniciarEdicao(barco: Embarcacao) {
    setEditandoId(barco.id);
    setEditForm(formularioDoBarco(barco));
    setMostrarSenhaEdicao(false);
    setBuscandoSenha(true);

    try {
      const acessoDoc = await getDoc(doc(db, "acessos_comandantes", barco.id));

      if (acessoDoc.exists()) {
        setEditForm((atual) => ({
          ...atual,
          senhaComandante: String(acessoDoc.data().senha || ""),
        }));
      }
    } catch (error) {
      console.error("Erro ao buscar senha:", error);
      await modal.erro(
        "Erro ao buscar senha",
        "Não foi possível carregar a senha do comandante.",
      );
    } finally {
      setBuscandoSenha(false);
    }
  }

  async function salvarEdicao(idOriginal: string) {
    const erro = validarFormulario(editForm);

    if (erro || buscandoSenha) {
      await modal.aviso("Dados obrigatórios", erro || "Aguarde carregar os dados.");
      return;
    }

    setSalvando(true);

    try {
      const novoId = normalizarId(editForm.idBarco);
      const embarcacaoAnterior = barcos.find((barco) => barco.id === idOriginal) || {};

      await setDoc(
        doc(db, "embarcacoes", novoId),
        montarEmbarcacaoPayload(editForm, embarcacaoAnterior),
        { merge: true },
      );

      await salvarVinculos(editForm);

      if (idOriginal !== novoId) {
        const referencias = [
          {colecao: "programacoes_viagem", campo: "barcoId"},
          {colecao: "programacoes_viagem", campo: "embarcacaoId"},
          {colecao: "grades_viagens", campo: "id_barco"},
          {colecao: "grades_viagens", campo: "barcoId"},
          {colecao: "rotas_historicas", campo: "barcoId"},
          {colecao: "banners_promocionais", campo: "barcoId"},
          {colecao: "rastreadores", campo: "barcoId"},
          {colecao: "rastreadores", campo: "barcoIdAdmin"},
        ];
        for (const referencia of referencias) {
          const encontrados = await getDocs(query(
            collection(db, referencia.colecao),
            where(referencia.campo, "==", idOriginal),
          ));
          for (const item of encontrados.docs) {
            await updateDoc(item.ref, {
              [referencia.campo]: novoId,
              atualizadoEm: serverTimestamp(),
            });
          }
        }
        await deleteDoc(doc(db, "embarcacoes", idOriginal));
        await deleteDoc(doc(db, "acessos_comandantes", idOriginal));
      }

      cancelarEdicao();

      await modal.sucesso(
        "Cadastro atualizado",
        "Embarcação, dono, acesso e GPS foram atualizados.",
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao atualizar",
        error?.message || "Não foi possível atualizar a embarcação.",
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0d0c2c] p-5 text-white lg:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.25em]">
            Frota operacional
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            Cadastro unificado de embarcação
          </h1>
          <p className="mt-1 text-sm text-sky-100/55">
            Cadastre barco, dono, acesso do comandante e GPS em uma única área.
          </p>
        </div>

        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar embarcação, dono, ID, GPS ou status..."
          className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 xl:w-[420px]"
        />
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <MiniResumo label="Embarcações" valor={resumo.total} />
        <MiniResumo label="Online" valor={resumo.online} />
        <MiniResumo label="Com GPS" valor={resumo.comGps} />
        <MiniResumo label="Completos" valor={resumo.completos} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[470px_1fr]">
        <section className="rounded-3xl border border-[#7ba6d4]/25 bg-[#0f2240] p-5 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-black">Nova embarcação</h2>
            <p className="mt-1 text-xs text-sky-100/55">
              O sistema cria os vínculos principais sem abrir o Firebase.
            </p>
          </div>

          <FormularioCadastro
            form={form}
            alterar={alterarForm}
            mostrarSenha={mostrarSenhaCadastro}
            alternarSenha={() => setMostrarSenhaCadastro((atual) => !atual)}
            rastreadores={rastreadoresDisponiveis}
          />

          <button
            onClick={cadastrarBarco}
            disabled={salvando}
            className="mt-4 w-full rounded-2xl border border-emerald-300/35 bg-emerald-500/10 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-60"
          >
            {salvando ? "Processando..." : "Salvar cadastro unificado"}
          </button>
        </section>

        <section className="rounded-3xl border border-[#7ba6d4]/25 bg-[#0f2240] p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-black">Frota cadastrada</h2>
              <p className="mt-1 text-xs text-sky-100/55">
                {barcosFiltrados.length} resultado(s) encontrado(s).
              </p>
            </div>
          </div>

          {carregando ? (
            <div className="rounded-2xl border border-dashed border-[#7ba6d4]/25 bg-[#143760] p-8 text-center text-sm text-sky-100/55">
              Sincronizando frota...
            </div>
          ) : barcosFiltrados.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#7ba6d4]/25 bg-[#143760] p-8 text-center text-sm text-sky-100/55">
              Nenhuma embarcação encontrada.
            </div>
          ) : (
            <div className="grid gap-3">
              {barcosFiltrados.map((barco) => {
                // A edição agora abre em uma janela fixa e não expande o
                // cartão dentro da lista, evitando o deslocamento para o fundo azul.
                const emEdicao = false;
                const tipoAtual = tipoEmbarcacao(barco);
                const categoriaAtual = categoriaEmbarcacao(barco);

                return (
                  <div
                    key={barco.id}
                    className={[
                      "rounded-2xl border p-4 transition",
                      emEdicao
                        ? "border-amber-300/45 bg-amber-500/10"
                        : "border-[#7ba6d4]/25 bg-[#143760] hover:bg-[#17345e]",
                    ].join(" ")}
                  >
                    {emEdicao ? (
                      <div className="grid gap-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-200">
                            Modo de ajuste unificado
                          </p>
                          <h3 className="mt-1 text-base font-black text-white">
                            {barco.nome || barco.id}
                          </h3>
                        </div>

                        <FormularioCadastro
                          form={editForm}
                          alterar={alterarEditForm}
                          mostrarSenha={mostrarSenhaEdicao}
                          alternarSenha={() => setMostrarSenhaEdicao((atual) => !atual)}
                          disabledSenha={buscandoSenha}
                          rastreadores={rastreadores}
                        />
                        {normalizarId(editForm.idBarco) !== barco.id && (
                          <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                            <strong className="block">Atualização de ID operacional</strong>
                            {barco.id} → {normalizarId(editForm.idBarco)}. Ao salvar,
                            o sistema atualizará programação, rotas, banners, GPS e acessos
                            antes de remover o ID anterior.
                          </div>
                        )}

                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                          <button
                            onClick={() => salvarEdicao(barco.id)}
                            disabled={salvando || buscandoSenha}
                            className="rounded-xl border border-amber-300/35 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                          >
                            {salvando
                              ? "Gravando..."
                              : normalizarId(editForm.idBarco) !== barco.id
                                ? "Atualizar ID e dados"
                                : "Atualizar dados"}
                          </button>

                          <button
                            onClick={cancelarEdicao}
                            className="rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-base font-black text-white">
                                {barco.nome || "Embarcação sem nome"}
                              </h3>

                              <Badge texto={tipoAtual} cor="sky" />
                              <Badge texto={categoriaAtual} cor="emerald" />
                              <Badge
                                texto={`Sinal: ${statusSinal(barco).replace(/_/g, " ")}`}
                                cor={
                                  statusSinal(barco) === "ativo"
                                    ? "emerald"
                                    : "amber"
                                }
                              />
                              {barco.rastreadorDeviceId && (
                                <Badge texto="GPS" cor="amber" />
                              )}
                              {barco.online && <Badge texto="online" cor="emerald" />}
                              {barco.visivelNoApp !== false ? (
                                <Badge texto="No app" cor="emerald" />
                              ) : (
                                <Badge texto="Oculta no app" cor="amber" />
                              )}
                            </div>

                            <p className="mt-1 text-xs font-semibold text-sky-100/55">
                              ID: {barco.id} • Dono:{" "}
                              {barco.ownerEmail || barco.emailDono || "não vinculado"}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap gap-2">
                            <button
                              onClick={() => alterarVisibilidadeNoApp(barco)}
                              className={[
                                "rounded-xl border px-3 py-2 text-[10px] font-black uppercase transition",
                                barco.visivelNoApp !== false
                                  ? "border-amber-300/35 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
                                  : "border-emerald-300/35 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20",
                              ].join(" ")}
                            >
                              {barco.visivelNoApp !== false
                                ? "Ocultar do app"
                                : "Publicar no app"}
                            </button>

                            <button
                              onClick={() => iniciarEdicao(barco)}
                              className="rounded-xl border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-[10px] font-black uppercase text-sky-100 hover:bg-sky-300/20"
                            >
                              Editar
                            </button>

                            <button
                              onClick={() => excluirBarco(barco.id)}
                              className="rounded-xl border border-red-300/35 bg-red-500/10 px-3 py-2 text-[10px] font-black uppercase text-red-200 hover:bg-red-500/20"
                            >
                              Excluir tudo
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                          <Mini label="Status" valor={barco.status || "—"} />
                          <Mini label="OwnerId" valor={barco.ownerId || "—"} />
                          <Mini
                            label="Rastreador"
                            valor={barco.rastreadorDeviceId || "—"}
                          />
                          <Mini label="Plano" valor={categoriaAtual} />
                          <Mini
                            label="Situação do plano"
                            valor={barco.planoStatus || "ativo"}
                          />
                          <Mini
                            label="Validade"
                            valor={dataParaInput(barco.planoValidoAte) || "Sem vencimento"}
                          />
                          <Mini
                            label="Latitude"
                            valor={formatarCoord(barco.ultima_posicao?.latitude)}
                          />
                          <Mini
                            label="Longitude"
                            valor={formatarCoord(barco.ultima_posicao?.longitude)}
                          />
                          <Mini
                            label="Tipo usuário"
                            valor={barco.tipoUsuario || "dono"}
                          />
                          <Mini
                            label="GPS ativo"
                            valor={barco.rastreadorAtivo !== false ? "Sim" : "Não"}
                          />
                          <Mini
                            label="No aplicativo"
                            valor={barco.visivelNoApp !== false ? "Publicado" : "Oculto"}
                          />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {editandoId && barcoEmEdicao && (
        <div
          className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-[#020617]/85 px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-8"
          role="dialog"
          aria-modal="true"
          aria-label={`Editar ${barcoEmEdicao.nome || barcoEmEdicao.id}`}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-sky-300/30 bg-[#0f2240] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-sky-300/15 bg-[#0f2240]/95 px-4 py-4 backdrop-blur sm:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
                  Editar embarcação
                </p>
                <h2 className="truncate text-lg font-black text-white">
                  {barcoEmEdicao.nome || barcoEmEdicao.id}
                </h2>
                <p className="truncate text-xs text-sky-100/55">
                  ID atual: {barcoEmEdicao.id}
                </p>
              </div>

              <button
                type="button"
                onClick={cancelarEdicao}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xl font-black text-white hover:bg-white/10"
                aria-label="Fechar edição"
              >
                ×
              </button>
            </div>

            <div className="p-4 sm:p-6">
              {buscandoSenha && (
                <div className="mb-4 rounded-2xl border border-sky-300/20 bg-sky-300/10 p-4 text-sm font-semibold text-sky-100">
                  Carregando os dados da embarcação...
                </div>
              )}

              <FormularioCadastro
                form={editForm}
                alterar={alterarEditForm}
                mostrarSenha={mostrarSenhaEdicao}
                alternarSenha={() => setMostrarSenhaEdicao((atual) => !atual)}
                disabledSenha={buscandoSenha}
                rastreadores={rastreadores}
              />

              {normalizarId(editForm.idBarco) !== barcoEmEdicao.id && (
                <div className="mt-4 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                  <strong className="block">Atualização de ID operacional</strong>
                  {barcoEmEdicao.id} → {normalizarId(editForm.idBarco)}. Ao
                  salvar, o sistema atualizará programação, rotas, banners, GPS
                  e acessos antes de remover o ID anterior.
                </div>
              )}

              <div className="sticky bottom-0 -mx-4 mt-5 flex flex-col gap-2 border-t border-sky-300/15 bg-[#0f2240]/95 px-4 pb-1 pt-4 backdrop-blur sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
                <button
                  type="button"
                  onClick={cancelarEdicao}
                  className="rounded-xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-xs font-black uppercase text-sky-100 hover:bg-[#2b5b91]"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={() => salvarEdicao(barcoEmEdicao.id)}
                  disabled={salvando || buscandoSenha}
                  className="rounded-xl border border-amber-300/35 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase text-amber-200 hover:bg-amber-500/20 disabled:opacity-60"
                >
                  {salvando
                    ? "Gravando..."
                    : normalizarId(editForm.idBarco) !== barcoEmEdicao.id
                      ? "Atualizar ID e dados"
                      : "Atualizar dados"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormularioCadastro({
  form,
  alterar,
  mostrarSenha,
  alternarSenha,
  disabledSenha = false,
  rastreadores,
}: {
  form: FormularioEmbarcacao;
  alterar: (campo: keyof FormularioEmbarcacao, valor: any) => void;
  mostrarSenha: boolean;
  alternarSenha: () => void;
  disabledSenha?: boolean;
  rastreadores: Rastreador[];
}) {
  return (
    <div className="grid gap-4">
      <div className="rounded-2xl border border-sky-300/15 bg-[#143760] p-4">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-sky-200">
          Dados do barco
        </p>

        <div className="grid gap-3">
          <CampoTexto
            label="ID do barco"
            value={form.idBarco}
            onChange={(valor) => alterar("idBarco", valor)}
            placeholder="Ex: OBDENSE_V"
          />

          <CampoTexto
            label="Nome do barco"
            value={form.nomeBarco}
            onChange={(valor) => alterar("nomeBarco", valor)}
            placeholder="Ex: Obdense V"
          />

          <div className="grid gap-3 md:grid-cols-2">
            <CampoSelect
              label="Tipo do barco"
              value={form.tipoBarco}
              onChange={(valor) => alterar("tipoBarco", valor)}
              options={TIPOS_BARCO}
            />

            <CampoSelectComValor
              label="Plano comercial"
              value={form.planoId}
              onChange={(valor) => alterar("planoId", valor)}
              options={PLANOS}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <CampoSelect
              label="Situação do plano"
              value={form.planoStatus}
              onChange={(valor) => alterar("planoStatus", valor)}
              options={STATUS_PLANOS}
            />

            <CampoTexto
              label="Plano válido até"
              value={form.planoValidoAte}
              onChange={(valor) => alterar("planoValidoAte", valor)}
              tipo="date"
            />
          </div>

          <div className="rounded-2xl border border-sky-300/15 bg-sky-300/5 px-4 py-3">
            <p className="text-[10px] font-black uppercase text-sky-200">
              Regra de publicação
            </p>
            <p className="mt-1 text-xs leading-5 text-sky-100/60">
              Plano pago vencido será exibido como Básico sem apagar fotos,
              contatos, rotas ou configurações. Somente Tempo Real pode aparecer
              como posição no mapa.
            </p>
          </div>

          <CampoSenha
            label="Senha do comandante"
            value={form.senhaComandante}
            onChange={(valor) => alterar("senhaComandante", valor)}
            placeholder="Defina a senha..."
            mostrar={mostrarSenha}
            onToggle={alternarSenha}
            disabled={disabledSenha}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-violet-300/15 bg-[#143760] p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-200">
          Conteúdo liberado pelo plano
        </p>
        <p className="mt-1 text-xs leading-5 text-sky-100/55">
          {form.planoId === "basico"
            ? "Básico: foto principal, descrição, rota, escalas e horários da origem e do destino."
            : form.planoId === "vitrine"
              ? "Vitrine: perfil completo, até 5 fotos, presença digital, 1 contato e horários das escalas."
              : "Tempo Real: todos os dados da Vitrine, até 3 contatos, equipamento GPS, sinal e instalação."}
        </p>
        <div className="mt-3 grid gap-3">
          <CampoArea label="Descrição pública" value={form.descricao}
            onChange={(valor) => alterar("descricao", valor)}
            placeholder="Descrição que aparecerá no aplicativo" />
          <CampoArea label={form.planoId === "basico"
            ? "Foto principal — uma URL"
            : "Galeria — uma URL por linha, máximo 5"}
            value={form.fotosTexto}
            onChange={(valor) => alterar("fotosTexto", valor)}
            placeholder="https://..." />
          {form.planoId !== "basico" && (
            <>
              <CampoTexto label="WhatsApp principal" value={form.contato1}
                onChange={(valor) => alterar("contato1", valor)} />
              {form.planoId === "tempo_real" && (
                <div className="grid gap-3 md:grid-cols-2">
                  <CampoTexto label="WhatsApp 2" value={form.contato2}
                    onChange={(valor) => alterar("contato2", valor)} />
                  <CampoTexto label="WhatsApp 3" value={form.contato3}
                    onChange={(valor) => alterar("contato3", valor)} />
                </div>
              )}
              <div className="grid gap-3">
                <CampoTexto label="Instagram" value={form.instagramBarco}
                  onChange={(valor) => alterar("instagramBarco", valor)} />
                <CampoTexto label="Facebook" value={form.facebookBarco}
                  onChange={(valor) => alterar("facebookBarco", valor)} />
                <CampoTexto label="Site" value={form.siteBarco}
                  onChange={(valor) => alterar("siteBarco", valor)} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-emerald-300/15 bg-[#143760] p-4">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-emerald-200">
          Dono / armador
        </p>

        <div className="grid gap-3">
          <CampoTexto
            label="Nome do dono"
            value={form.donoNome}
            onChange={(valor) => alterar("donoNome", valor)}
            placeholder="Nome do armador"
          />

          <CampoTexto
            label="E-mail do dono"
            value={form.donoEmail}
            onChange={(valor) => alterar("donoEmail", valor)}
            placeholder="dono@email.com"
            tipo="email"
          />

          <div className="grid gap-3 md:grid-cols-2">
            <CampoTexto
              label="OwnerId"
              value={form.ownerId}
              onChange={(valor) => alterar("ownerId", valor)}
              placeholder="UID ou ID interno"
            />

            <CampoSelect
              label="Tipo de usuário"
              value={form.tipoUsuario}
              onChange={(valor) => alterar("tipoUsuario", valor)}
              options={TIPOS_USUARIO}
            />
          </div>
        </div>
      </div>

      {form.planoId === "tempo_real" && (
      <div className="rounded-2xl border border-amber-300/15 bg-[#143760] p-4">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200">
          GPS / rastreador
        </p>

        <div className="grid gap-3">
          <label>
            <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">
              Device ID do rastreador
            </p>
            <input
              value={form.rastreadorDeviceId}
              onChange={(e) => alterar("rastreadorDeviceId", e.target.value)}
              list="rastreadores-cadastro-unificado"
              placeholder="Ex: ESP32_E83744F7C630"
              className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60"
            />
            <datalist id="rastreadores-cadastro-unificado">
              {rastreadores.map((rastreador) => (
                <option
                  key={rastreador.id}
                  value={rastreador.id}
                  label={`${rastreador.barcoIdAdmin || rastreador.barcoId || "SEM_BARCO"} • ${
                    rastreador.wifiSSIDAtual ||
                    rastreador.wifiNome ||
                    rastreador.status ||
                    "rastreador"
                  }`}
                />
              ))}
            </datalist>
          </label>

          <CampoTexto
            label="Nome na rede"
            value={form.nomeNaRede}
            onChange={(valor) => alterar("nomeNaRede", valor)}
            placeholder="Ex: CMB_OBDENSE_V"
          />
          <CampoSelect
            label="Situação da instalação"
            value={form.statusInstalacaoGps}
            onChange={(valor) => alterar("statusInstalacaoGps", valor)}
            options={["aguardando_contato", "agendada", "equipamento_enviado", "instalado", "ativo"]}
          />
          <CampoArea label="Informações da instalação/equipamento"
            value={form.observacoesInstalacaoGps}
            onChange={(valor) => alterar("observacoesInstalacaoGps", valor)}
            placeholder="Ex.: equipe entrará em contato; equipamento será enviado configurado..." />

          <label className="flex items-center justify-between gap-3 rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3">
            <div>
              <p className="text-[10px] font-black uppercase text-sky-100/55">
                Ativar GPS
              </p>
              <p className="mt-1 text-xs text-sky-100/45">
                Vincula o rastreador e deixa a embarcação pronta para rastrear.
              </p>
            </div>

            <input
              type="checkbox"
              checked={form.ativarGps}
              onChange={(e) => alterar("ativarGps", e.target.checked)}
              className="h-5 w-5"
            />
          </label>
        </div>
      </div>
      )}
    </div>
  );
}

function CampoArea({
  label, value, onChange, placeholder,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>
      <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white outline-none placeholder:text-sky-100/40 focus:border-sky-300/60" />
    </label>
  );
}

function CampoTexto({
  label,
  value,
  onChange,
  placeholder,
  tipo = "text",
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  tipo?: string;
  disabled?: boolean;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>
      <input
        type={tipo}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function CampoSenha({
  label,
  value,
  onChange,
  placeholder,
  mostrar,
  onToggle,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  mostrar: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>

      <div className="relative">
        <input
          type={mostrar ? "text" : "password"}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] py-3 pl-4 pr-12 text-sm font-semibold text-white shadow-sm outline-none placeholder:text-sky-100/40 focus:border-sky-300/60 disabled:cursor-not-allowed disabled:opacity-60"
        />

        <button
          type="button"
          onClick={onToggle}
          disabled={disabled}
          className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-sky-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          title={mostrar ? "Ocultar senha" : "Mostrar senha"}
        >
          {mostrar ? "🙈" : "👁️"}
        </button>
      </div>
    </label>
  );
}

function CampoSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  options: string[];
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none focus:border-sky-300/60"
      >
        {options.map((opcao) => (
          <option key={opcao} value={opcao}>
            {opcao}
          </option>
        ))}
      </select>
    </label>
  );
}

function CampoSelectComValor({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <label>
      <p className="mb-2 text-[10px] font-black uppercase text-sky-100/55">{label}</p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-[#7ba6d4]/25 bg-[#17345e] px-4 py-3 text-sm font-semibold text-white shadow-sm outline-none focus:border-sky-300/60"
      >
        {options.map((opcao) => (
          <option key={opcao.value} value={opcao.value}>
            {opcao.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Badge({ texto, cor }: { texto: string; cor: "sky" | "emerald" | "amber" }) {
  const classes = {
    sky: "border-sky-300/25 bg-sky-300/10 text-sky-100",
    emerald: "border-emerald-300/25 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-300/25 bg-amber-500/10 text-amber-200",
  };

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[9px] font-black uppercase ${classes[cor]}`}
    >
      {texto}
    </span>
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
