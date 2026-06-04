import React, { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { getAuth, onAuthStateChanged, type User } from "firebase/auth";
import { db } from "../config/firebase";
import { useAppModal } from "../components/AppModal";

type PermissaoKey =
  | "mapa"
  | "rotas"
  | "frota"
  | "portos"
  | "banners"
  | "gps"
  | "rastreadores"
  | "modoTesteGps"
  | "controleGps"
  | "prospeccao"
  | "financeiro"
  | "inteligencia"
  | "notificacoes"
  | "funcionarios";

type Funcionario = {
  id: string;
  uid?: string;
  nome: string;
  email: string;
  tipo: "admin" | "funcionario";
  ativo: boolean;
  excluido?: boolean;
  mustChangePassword?: boolean;
  primeiroAcesso?: boolean;
  permissoes: Record<string, boolean>;
};

const URL_CRIAR_FUNCIONARIO =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/criarFuncionarioSistema";

const URL_REDEFINIR_SENHA =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/redefinirSenhaFuncionarioSistema";

const URL_EXCLUIR_FUNCIONARIO =
  "https://us-central1-sistema-navegacao.cloudfunctions.net/excluirFuncionarioSistema";

const ADMIN_FIXOS = ["jandessonmoraes@gmail.com", "escdecastrousinagen@gmail.com"];

const PERMISSOES: {
  key: PermissaoKey;
  titulo: string;
  descricao: string;
  grupo: string;
}[] = [
  {
    key: "mapa",
    titulo: "Mapa Tático",
    descricao: "Ver mapa operacional dos barcos.",
    grupo: "Operação",
  },
  {
    key: "rotas",
    titulo: "Rotas",
    descricao: "Ver rotas, trechos oficiais e malha inteligente.",
    grupo: "Operação",
  },
  {
    key: "frota",
    titulo: "Frota / Embarcações",
    descricao: "Ver e gerenciar embarcações.",
    grupo: "Cadastros",
  },
  {
    key: "portos",
    titulo: "Portos / Terminais",
    descricao: "Ver e editar portos e terminais.",
    grupo: "Cadastros",
  },
  {
    key: "banners",
    titulo: "Banners",
    descricao: "Gerenciar banners promocionais.",
    grupo: "Comercial",
  },
  {
    key: "gps",
    titulo: "GPS",
    descricao: "Acessar rastreadores, configuração, provisionamento e modo teste.",
    grupo: "GPS",
  },
  {
    key: "notificacoes",
    titulo: "Notificações",
    descricao: "Configurar e enviar notificações.",
    grupo: "Comunicação",
  },
  {
    key: "prospeccao",
    titulo: "Prospecção",
    descricao: "Cadastrar oportunidades, contatos e retornos comerciais.",
    grupo: "Comercial",
  },
  {
    key: "financeiro",
    titulo: "Financeiro",
    descricao: "Ver clientes, mensalidades, pagamentos e relatórios financeiros.",
    grupo: "Administração",
  },
  {
    key: "inteligencia",
    titulo: "Inteligência Comercial",
    descricao: "Ver relatórios e dados comerciais.",
    grupo: "Comercial",
  },
  {
    key: "funcionarios",
    titulo: "Permissões de Usuários",
    descricao: "Criar usuários e liberar acessos.",
    grupo: "Administração",
  },
];

const PERMISSOES_PADRAO: Record<PermissaoKey, boolean> = {
  mapa: true,
  rotas: false,
  frota: false,
  portos: false,
  banners: false,
  gps: false,
  rastreadores: false,
  modoTesteGps: false,
  controleGps: false,
  prospeccao: false,
  financeiro: false,
  inteligencia: false,
  notificacoes: false,
  funcionarios: false,
};

function normalizarEmail(email: string) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function permissoesAdmin() {
  return PERMISSOES.reduce(
    (acc, permissao) => {
      acc[permissao.key] = true;
      return acc;
    },
    {} as Record<PermissaoKey, boolean>,
  );
}

function isAdminFixo(email: string) {
  return ADMIN_FIXOS.includes(normalizarEmail(email));
}

function normalizarPermissoesSalvas(permissoesSalvas: Record<string, boolean>) {
  const gpsLegado =
    permissoesSalvas.gps === true ||
    permissoesSalvas.rastreadores === true ||
    permissoesSalvas.controleGps === true ||
    permissoesSalvas.modoTesteGps === true;

  return {
    ...PERMISSOES_PADRAO,
    ...(permissoesSalvas as Record<PermissaoKey, boolean>),
    gps: gpsLegado,
    rastreadores: gpsLegado,
    controleGps: gpsLegado,
    modoTesteGps: gpsLegado,
  };
}

function prepararPermissoesParaSalvar(permissoesAtuais: Record<PermissaoKey, boolean>) {
  const gpsAtivo = permissoesAtuais.gps === true;

  return {
    ...permissoesAtuais,
    rastreadores: gpsAtivo,
    controleGps: gpsAtivo,
    modoTesteGps: gpsAtivo,
  };
}

function gerarSenhaTemporaria() {
  const parte = Math.random().toString(36).slice(2, 8).toUpperCase();
  const numero = Math.floor(100 + Math.random() * 900);
  return `CMB-${parte}-${numero}`;
}

async function chamarFuncaoAdmin(url: string, body: any) {
  const usuario = getAuth().currentUser;

  if (!usuario) {
    throw new Error("Faça login novamente.");
  }

  const idToken = await usuario.getIdToken();

  const resposta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const dados = await resposta.json().catch(() => ({}));

  if (!resposta.ok || dados.erro) {
    throw new Error(dados.erro || dados.detalhe || "Erro ao executar ação.");
  }

  return dados;
}

export default function FuncionariosPermissoes() {
  const [usuarioAtual, setUsuarioAtual] = useState<User | null>(null);
  const [carregandoAuth, setCarregandoAuth] = useState(true);
  const emailAtual = normalizarEmail(usuarioAtual?.email || "");

  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senhaTemporaria, setSenhaTemporaria] = useState(gerarSenhaTemporaria());
  const [tipo, setTipo] = useState<"admin" | "funcionario">("funcionario");
  const [permissoes, setPermissoes] =
    useState<Record<PermissaoKey, boolean>>(PERMISSOES_PADRAO);
  const [salvando, setSalvando] = useState(false);
  const [busca, setBusca] = useState("");
  const [processandoEmail, setProcessandoEmail] = useState("");
  const modal = useAppModal();

  const adminAtual = isAdminFixo(emailAtual);

  useEffect(() => {
    const auth = getAuth();

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUsuarioAtual(user);
      setCarregandoAuth(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (carregandoAuth || !adminAtual) return;

    const unsubscribe = onSnapshot(collection(db, "funcionarios"), (snapshot) => {
      const lista = snapshot.docs
        .map((docSnap) => {
          const dados = docSnap.data() as any;

          return {
            id: docSnap.id,
            uid: dados.uid,
            nome: String(dados.nome || ""),
            email: String(dados.email || docSnap.id),
            tipo: dados.tipo === "admin" ? "admin" : "funcionario",
            ativo: dados.ativo !== false,
            excluido: dados.excluido === true,
            mustChangePassword: dados.mustChangePassword === true,
            primeiroAcesso: dados.primeiroAcesso === true,
            permissoes: normalizarPermissoesSalvas(dados.permissoes || {}),
          } as Funcionario;
        })
        .filter((item) => !item.excluido)
        .sort((a, b) => a.nome.localeCompare(b.nome));

      const adminsFixos: Funcionario[] = ADMIN_FIXOS.map((adminEmail) => {
        const existente = lista.find(
          (item) => normalizarEmail(item.email) === adminEmail,
        );

        return (
          existente || {
            id: adminEmail,
            nome:
              adminEmail === "jandessonmoraes@gmail.com" ? "Jandesson Moraes" : "Elias",
            email: adminEmail,
            tipo: "admin",
            ativo: true,
            permissoes: permissoesAdmin(),
          }
        );
      });

      const outros = lista.filter(
        (item) => !ADMIN_FIXOS.includes(normalizarEmail(item.email)),
      );

      setFuncionarios([...adminsFixos, ...outros]);
    });

    return () => unsubscribe();
  }, [adminAtual, carregandoAuth]);

  const usuariosFiltrados = useMemo(() => {
    const texto = busca.trim().toLowerCase();

    if (!texto) return funcionarios;

    return funcionarios.filter((funcionario) =>
      [funcionario.nome, funcionario.email, funcionario.tipo]
        .join(" ")
        .toLowerCase()
        .includes(texto),
    );
  }, [funcionarios, busca]);

  const grupos = useMemo(() => {
    return PERMISSOES.reduce(
      (acc, permissao) => {
        if (!acc[permissao.grupo]) acc[permissao.grupo] = [];
        acc[permissao.grupo].push(permissao);
        return acc;
      },
      {} as Record<string, typeof PERMISSOES>,
    );
  }, []);

  const resetForm = () => {
    setNome("");
    setEmail("");
    setSenhaTemporaria(gerarSenhaTemporaria());
    setTipo("funcionario");
    setPermissoes(PERMISSOES_PADRAO);
  };

  const editarUsuario = (usuario: Funcionario) => {
    setNome(usuario.nome);
    setEmail(usuario.email);
    setSenhaTemporaria(gerarSenhaTemporaria());
    setTipo(usuario.tipo);
    setPermissoes(normalizarPermissoesSalvas(usuario.permissoes || {}));
  };

  const salvarUsuario = async () => {
    try {
      const emailNormalizado = normalizarEmail(email);

      if (!adminAtual) {
        await modal.erro(
          "Acesso negado",
          "Você não tem permissão para executar esta ação.",
        );
        return;
      }

      if (!nome.trim() || !emailNormalizado || !senhaTemporaria.trim()) {
        await modal.aviso(
          "Dados obrigatórios",
          "Informe nome, e-mail e senha temporária.",
        );
        return;
      }

      setSalvando(true);

      const adminFixo = isAdminFixo(emailNormalizado);
      const tipoFinal = adminFixo ? "admin" : tipo;
      const permissoesFinais =
        tipoFinal === "admin"
          ? permissoesAdmin()
          : prepararPermissoesParaSalvar(permissoes);

      const dados = await chamarFuncaoAdmin(URL_CRIAR_FUNCIONARIO, {
        nome: nome.trim(),
        email: emailNormalizado,
        senhaTemporaria: senhaTemporaria.trim(),
        tipo: tipoFinal,
        permissoes: permissoesFinais,
      });

      await modal.sucesso(
        "Acesso criado/atualizado",
        `${dados.mensagem}\n\nSenha temporária: ${senhaTemporaria}`,
      );
      resetForm();
    } catch (error: any) {
      await modal.erro(
        "Erro ao salvar usuário",
        error?.message || "Não foi possível salvar o usuário.",
      );
    } finally {
      setSalvando(false);
    }
  };

  const redefinirSenha = async (usuario: Funcionario) => {
    try {
      const novaSenha = gerarSenhaTemporaria();
      setProcessandoEmail(usuario.email);

      const dados = await chamarFuncaoAdmin(URL_REDEFINIR_SENHA, {
        email: usuario.email,
        senhaTemporaria: novaSenha,
      });

      await modal.sucesso(
        "Senha temporária criada",
        `${dados.mensagem}\n\nNova senha temporária: ${novaSenha}`,
      );
    } catch (error: any) {
      await modal.erro(
        "Erro ao redefinir senha",
        error?.message || "Não foi possível redefinir a senha.",
      );
    } finally {
      setProcessandoEmail("");
    }
  };

  const excluirUsuario = async (usuario: Funcionario) => {
    try {
      if (isAdminFixo(usuario.email)) {
        await modal.aviso(
          "Ação bloqueada",
          "Administradores fixos não podem ser excluídos.",
        );
        return;
      }

      const confirmou = await modal.confirmar({
        tipo: "warning",
        titulo: "Excluir acesso?",
        mensagem: `Excluir o acesso de ${usuario.nome || usuario.email}?\n\nIsso remove o usuário do Firebase Authentication e marca como excluído no Firestore.`,
        confirmarTexto: "Excluir",
        cancelarTexto: "Cancelar",
      });

      if (!confirmou) return;

      setProcessandoEmail(usuario.email);

      const dados = await chamarFuncaoAdmin(URL_EXCLUIR_FUNCIONARIO, {
        email: usuario.email,
      });

      await modal.sucesso("Usuário excluído", dados.mensagem || "Usuário excluído.");
    } catch (error: any) {
      await modal.erro(
        "Erro ao excluir usuário",
        error?.message || "Não foi possível excluir o usuário.",
      );
    } finally {
      setProcessandoEmail("");
    }
  };

  const alternarAtivo = async (usuario: Funcionario) => {
    if (isAdminFixo(usuario.email)) {
      await modal.aviso(
        "Ação bloqueada",
        "Administradores fixos não podem ser desativados.",
      );
      return;
    }

    await setDoc(
      doc(db, "funcionarios", normalizarEmail(usuario.email)),
      {
        ativo: !usuario.ativo,
        atualizadoEm: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const preencherAdminFixos = async () => {
    if (!adminAtual) return;

    await Promise.all(
      ADMIN_FIXOS.map((adminEmail) =>
        setDoc(
          doc(db, "funcionarios", adminEmail),
          {
            nome:
              adminEmail === "jandessonmoraes@gmail.com" ? "Jandesson Moraes" : "Elias",
            email: adminEmail,
            tipo: "admin",
            ativo: true,
            excluido: false,
            mustChangePassword: false,
            primeiroAcesso: false,
            permissoes: permissoesAdmin(),
            atualizadoEm: serverTimestamp(),
            criadoEm: serverTimestamp(),
          },
          { merge: true },
        ),
      ),
    );

    await modal.sucesso(
      "Administradores conferidos",
      "Administradores fixos conferidos.",
    );
  };

  if (carregandoAuth) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="rounded-3xl border border-sky-400/20 bg-sky-400/10 p-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-300">
            Verificando acesso
          </p>
          <h1 className="mt-3 text-3xl font-black">Permissões de Usuários</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Aguarde enquanto confirmamos seu login de administrador.
          </p>
        </div>
      </div>
    );
  }

  if (!adminAtual) {
    return (
      <div className="min-h-screen bg-slate-950 p-6 text-white">
        <div className="rounded-3xl border border-red-400/20 bg-red-400/10 p-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-red-300">
            Acesso restrito
          </p>
          <h1 className="mt-3 text-3xl font-black">Permissões de Usuários</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
            Esta área é exclusiva para Jandesson e Elias. Faça login com uma conta
            administradora para gerenciar usuários.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="grid gap-6 xl:grid-cols-[440px_1fr]">
        <section className="rounded-3xl border border-white/5 bg-slate-900/70 p-5">
          <h2 className="text-lg font-black">Criar / Editar acesso</h2>

          <div className="mt-5 grid gap-4">
            <Input
              label="Nome"
              value={nome}
              onChange={setNome}
              placeholder="Nome do usuário"
            />
            <Input
              label="E-mail"
              value={email}
              onChange={setEmail}
              placeholder="usuario@email.com"
            />

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-black uppercase text-slate-500">
                  Senha temporária
                </p>
                <button
                  onClick={() => setSenhaTemporaria(gerarSenhaTemporaria())}
                  className="text-[10px] font-black uppercase text-sky-300 hover:text-sky-200"
                >
                  Gerar nova
                </button>
              </div>
              <input
                value={senhaTemporaria}
                onChange={(e) => setSenhaTemporaria(e.target.value)}
                className="w-full rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
              />
              <p className="mt-1 text-[11px] text-amber-300">
                Copie e envie esta senha ao usuário. Ao entrar, ele deverá criar outra.
              </p>
            </div>

            <label>
              <p className="mb-2 text-[10px] font-black uppercase text-slate-500">Tipo</p>
              <select
                value={tipo}
                onChange={(e) =>
                  setTipo(e.target.value === "admin" ? "admin" : "funcionario")
                }
                className="w-full rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none focus:border-sky-400/40"
              >
                <option value="funcionario">Usuário</option>
                <option value="admin">Administrador</option>
              </select>
            </label>

            <div className="rounded-2xl border border-white/5 bg-slate-950 p-4">
              <p className="text-[10px] font-black uppercase text-slate-500">
                Permissões
              </p>

              <div className="mt-3 grid gap-2">
                {PERMISSOES.map((permissao) => (
                  <label
                    key={permissao.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-slate-900/70 px-3 py-2"
                  >
                    <div>
                      <p className="text-xs font-black text-slate-200">
                        {permissao.titulo}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-600">
                        {permissao.descricao}
                      </p>
                    </div>

                    <input
                      type="checkbox"
                      checked={tipo === "admin" || !!permissoes[permissao.key]}
                      disabled={tipo === "admin"}
                      onChange={(e) =>
                        setPermissoes((atuais) => ({
                          ...atuais,
                          [permissao.key]: e.target.checked,
                        }))
                      }
                      className="h-5 w-5 shrink-0"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={salvarUsuario}
                disabled={salvando}
                className="rounded-2xl border border-sky-400/20 bg-sky-400/10 px-5 py-4 text-xs font-black uppercase text-sky-300 hover:bg-sky-400/20 disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Criar / atualizar"}
              </button>

              <button
                onClick={resetForm}
                className="rounded-2xl border border-slate-700 bg-slate-950 px-5 py-4 text-xs font-black uppercase text-slate-300 hover:bg-slate-900"
              >
                Limpar
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/5 bg-slate-900/70 p-5">
          <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="text-lg font-black">Usuários cadastrados</h2>
            </div>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar usuário..."
              className="w-full rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40 xl:w-[320px]"
            />
          </div>

          <div className="grid gap-3">
            {usuariosFiltrados.map((funcionario) => {
              const adminFixo = isAdminFixo(funcionario.email);
              const permissoesAtivas =
                funcionario.tipo === "admin"
                  ? PERMISSOES.length
                  : Object.values(funcionario.permissoes || {}).filter(Boolean).length;
              const processando = processandoEmail === funcionario.email;

              return (
                <div
                  key={funcionario.email}
                  className="rounded-2xl border border-white/5 bg-slate-950/70 p-4"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-base font-black text-white">
                          {funcionario.nome || funcionario.email}
                        </h3>

                        <Badge
                          texto={funcionario.tipo === "admin" ? "admin" : "usuário"}
                          cor={funcionario.tipo === "admin" ? "sky" : "slate"}
                        />
                        {adminFixo && <Badge texto="fixo" cor="emerald" />}
                        {!funcionario.ativo && <Badge texto="inativo" cor="red" />}
                        {funcionario.mustChangePassword && (
                          <Badge texto="trocar senha" cor="amber" />
                        )}
                      </div>

                      <p className="mt-1 text-xs text-slate-500">{funcionario.email}</p>
                    </div>

                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        onClick={() => editarUsuario(funcionario)}
                        className="rounded-xl border border-sky-400/20 bg-sky-400/10 px-4 py-2 text-xs font-black uppercase text-sky-300 hover:bg-sky-400/20"
                      >
                        Editar
                      </button>

                      <button
                        onClick={() => redefinirSenha(funcionario)}
                        disabled={processando}
                        className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs font-black uppercase text-amber-300 hover:bg-amber-400/20 disabled:opacity-60"
                      >
                        Nova senha
                      </button>

                      <button
                        onClick={() => alternarAtivo(funcionario)}
                        disabled={adminFixo}
                        className="rounded-xl border border-slate-600 bg-slate-900 px-4 py-2 text-xs font-black uppercase text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                      >
                        {funcionario.ativo ? "Desativar" : "Ativar"}
                      </button>

                      <button
                        onClick={() => excluirUsuario(funcionario)}
                        disabled={processando || adminFixo}
                        className="rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-2 text-xs font-black uppercase text-red-300 hover:bg-red-400/20 disabled:opacity-50"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <Mini label="Permissões" valor={permissoesAtivas} />
                    <Mini
                      label="Status"
                      valor={funcionario.ativo ? "Ativo" : "Inativo"}
                    />
                    <Mini
                      label="Tipo"
                      valor={funcionario.tipo === "admin" ? "Administrador" : "Usuário"}
                    />
                    <Mini
                      label="Senha"
                      valor={funcionario.mustChangePassword ? "Temporária" : "Definida"}
                    />
                  </div>

                  <div className="mt-4 grid gap-3 xl:grid-cols-3">
                    {Object.entries(grupos).map(([grupo, itens]) => (
                      <div
                        key={grupo}
                        className="rounded-2xl border border-white/5 bg-slate-900/70 p-3"
                      >
                        <p className="text-[10px] font-black uppercase text-slate-500">
                          {grupo}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {itens.map((item) => {
                            const ativo =
                              funcionario.tipo === "admin" ||
                              funcionario.permissoes?.[item.key];

                            return (
                              <span
                                key={item.key}
                                className={[
                                  "rounded-full border px-2 py-1 text-[10px] font-bold",
                                  ativo
                                    ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                                    : "border-slate-700 bg-slate-950 text-slate-600",
                                ].join(" ")}
                              >
                                {item.titulo}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function Input({
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
      <p className="mb-2 text-[10px] font-black uppercase text-slate-500">{label}</p>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-white/5 bg-slate-950 px-4 py-3 text-sm font-bold text-white outline-none placeholder:text-slate-600 focus:border-sky-400/40"
      />
    </label>
  );
}

function Badge({
  texto,
  cor,
}: {
  texto: string;
  cor: "sky" | "emerald" | "red" | "slate" | "amber";
}) {
  const classes = {
    sky: "border-sky-400/20 bg-sky-400/10 text-sky-300",
    emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
    red: "border-red-400/20 bg-red-400/10 text-red-300",
    slate: "border-slate-700 bg-slate-900 text-slate-400",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  };

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${classes[cor]}`}
    >
      {texto}
    </span>
  );
}

function Mini({ label, valor }: { label: string; valor: any }) {
  return (
    <div className="rounded-xl border border-white/5 bg-slate-900/80 p-3">
      <p className="text-[9px] font-black uppercase text-slate-600">{label}</p>
      <p className="mt-1 truncate text-sm font-black text-slate-200">{valor}</p>
    </div>
  );
}
