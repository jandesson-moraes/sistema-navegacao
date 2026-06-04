import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../config/firebase";

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

type MenuItem = {
  to: string;
  icon: string;
  label: string;
  match?: string[];
  badge?: string;
  permissao?: PermissaoKey;
};

const principal: MenuItem[] = [
  {
    to: "/",
    icon: "▱",
    label: "Mapa Tático",
    match: ["/", "/dashboard"],
    permissao: "mapa",
  },
  {
    to: "/embarcacoes",
    icon: "▰",
    label: "Embarcações",
    match: ["/embarcacoes", "/frota"],
    permissao: "frota",
  },
  {
    to: "/terminais",
    icon: "⚓",
    label: "Portos",
    match: ["/terminais"],
    permissao: "portos",
  },
  {
    to: "/banners",
    icon: "▣",
    label: "Banners",
    match: ["/banners"],
    permissao: "banners",
  },
];

const admin: MenuItem[] = [
  {
    to: "/gps",
    icon: "◎",
    label: "GPS",
    match: [
      "/gps",
      "/rastreadores",
      "/gestao-gps",
      "/controle-gps",
      "/provisionamento-gps",
      "/modo-teste-gps",
    ],
  },
  {
    to: "/rotas",
    icon: "⌁",
    label: "Rotas",
    match: ["/rotas"],
    permissao: "rotas",
  },
  {
    to: "/inteligencia-comercial",
    icon: "▥",
    label: "Inteligência Comercial",
    match: ["/inteligencia-comercial"],
    permissao: "inteligencia",
  },
  {
    to: "/prospeccao",
    icon: "◒",
    label: "Prospecção",
    match: ["/prospeccao"],
    permissao: "prospeccao",
  },
  {
    to: "/notificacoes",
    icon: "◌",
    label: "Notificações",
    match: ["/notificacoes"],
    badge: "3",
    permissao: "notificacoes",
  },
  {
    to: "/funcionarios",
    icon: "☷",
    label: "Permissões de Usuários",
    match: ["/funcionarios"],
    permissao: "funcionarios",
  },
  {
    to: "/financeiro",
    icon: "◈",
    label: "Financeiro",
    match: ["/financeiro"],
    permissao: "financeiro",
  },
];

const titulos: Record<string, string> = {
  "/": "Mapa Tático",
  "/dashboard": "Mapa Tático",
  "/rotas": "Rotas",
  "/embarcacoes": "Gestão de Frota",
  "/frota": "Gestão de Frota",
  "/terminais": "Terminais e Portos",
  "/banners": "Banners",
  "/gps": "GPS",
  "/rastreadores": "GPS",
  "/inteligencia-comercial": "Inteligência Comercial",
  "/prospeccao": "Prospecção",
  "/notificacoes": "Notificações",
  "/modo-teste-gps": "GPS",
  "/controle-gps": "GPS",
  "/provisionamento-gps": "GPS",
  "/gestao-gps": "GPS",
  "/usuarios": "Permissões de Usuários",
  "/funcionarios": "Permissões de Usuários",
  "/financeiro": "Financeiro",
};

const subtitulos: Record<string, string> = {
  "/": "Acompanhe em tempo real a localização e o status da frota",
  "/dashboard": "Acompanhe em tempo real a localização e o status da frota",
  "/rotas": "Gerencie rotas, trechos oficiais e histórico operacional",
  "/embarcacoes": "Cadastre e acompanhe embarcações do sistema",
  "/frota": "Cadastre e acompanhe embarcações do sistema",
  "/terminais": "Gerencie portos, terminais e pontos de parada",
  "/banners": "Organize banners e comunicações promocionais",
  "/gps": "Rastreadores, configuração, provisionamento e modo teste",
  "/rastreadores": "Rastreadores, configuração, provisionamento e modo teste",
  "/inteligencia-comercial": "Indicadores e visão comercial da operação",
  "/prospeccao": "Oportunidades, contatos, retornos e conversão em clientes",
  "/notificacoes": "Envio manual, automático e inteligente de avisos",
  "/modo-teste-gps": "Rastreadores, configuração, provisionamento e modo teste",
  "/gestao-gps": "Rastreadores, configuração, provisionamento e modo teste",
  "/controle-gps": "Rastreadores, configuração, provisionamento e modo teste",
  "/provisionamento-gps": "Rastreadores, configuração, provisionamento e modo teste",
  "/usuarios": "Equipe, acessos e permissões do sistema",
  "/funcionarios": "Equipe, acessos e permissões do sistema",
  "/financeiro":
    "Clientes GPS, mensalidades, movimentos, fornecedores, saldo e relatórios",
};

const ADMIN_FIXOS = ["jandessonmoraes@gmail.com", "escdecastrousinagen@gmail.com"];

function normalizarEmail(email: string) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isAdminFixo(email: string) {
  return ADMIN_FIXOS.includes(normalizarEmail(email));
}

function permissaoAtiva(permissoes: Record<string, boolean>, permissao?: PermissaoKey) {
  if (!permissao) return true;

  if (permissao === "gps") {
    return (
      permissoes.gps === true ||
      permissoes.rastreadores === true ||
      permissoes.controleGps === true ||
      permissoes.modoTesteGps === true
    );
  }

  return permissoes[permissao] === true;
}

function iniciaisUsuario(user: User | null) {
  const nome = user?.displayName || user?.email || "Usuário";
  const partes = nome
    .replace(/@.*/, "")
    .split(/[.\s_-]+/)
    .filter(Boolean);

  if (partes.length >= 2) {
    return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
  }

  return nome.slice(0, 2).toUpperCase();
}

function nomeUsuario(user: User | null) {
  if (!user) return "Visitante";
  return user.displayName || user.email || "Usuário logado";
}

function NavLink({ item }: { item: MenuItem }) {
  const location = useLocation();
  const ativo = item.match?.includes(location.pathname) || location.pathname === item.to;

  return (
    <Link
      to={item.to}
      className={[
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all duration-200",
        ativo
          ? "bg-sky-500/[0.14] text-white shadow-[inset_3px_0_0_#38bdf8]"
          : "text-slate-300/80 hover:bg-white/8 hover:text-white",
      ].join(" ")}
    >
      <span
        className={[
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-black transition",
          ativo
            ? "bg-sky-400/[0.18] text-sky-200"
            : "bg-white/5 text-slate-400 group-hover:text-sky-200",
        ].join(" ")}
      >
        {item.icon}
      </span>

      <span className="min-w-0 flex-1 truncate">{item.label}</span>

      {item.badge && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-[10px] font-black text-white">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const tituloHeader = titulos[location.pathname] || "Painel";
  const subtituloHeader =
    subtitulos[location.pathname] || "Central de operação do sistema";
  const [usuario, setUsuario] = useState<User | null>(null);
  const [permissoesUsuario, setPermissoesUsuario] = useState<Record<string, boolean>>({});
  const [tipoUsuario, setTipoUsuario] = useState<"admin" | "funcionario" | "visitante">(
    "visitante",
  );
  const [carregandoPermissoes, setCarregandoPermissoes] = useState(true);

  useEffect(() => {
    const auth = getAuth();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUsuario(user);
      setCarregandoPermissoes(true);

      try {
        if (!user?.email) {
          setPermissoesUsuario({});
          setTipoUsuario("visitante");
          return;
        }

        const emailNormalizado = normalizarEmail(user.email);

        if (isAdminFixo(emailNormalizado)) {
          const todasPermissoes = [
            "mapa",
            "rotas",
            "frota",
            "portos",
            "banners",
            "gps",
            "rastreadores",
            "modoTesteGps",
            "controleGps",
            "prospeccao",
            "financeiro",
            "inteligencia",
            "notificacoes",
            "funcionarios",
          ].reduce(
            (acc, key) => {
              acc[key] = true;
              return acc;
            },
            {} as Record<string, boolean>,
          );

          setPermissoesUsuario(todasPermissoes);
          setTipoUsuario("admin");
          return;
        }

        const snap = await getDoc(doc(db, "funcionarios", emailNormalizado));

        if (!snap.exists()) {
          setPermissoesUsuario({});
          setTipoUsuario("visitante");
          return;
        }

        const dados = snap.data() as any;

        if (dados.ativo === false || dados.excluido === true) {
          setPermissoesUsuario({});
          setTipoUsuario("visitante");
          return;
        }

        if (dados.tipo === "admin") {
          const todasPermissoes = [
            "mapa",
            "rotas",
            "frota",
            "portos",
            "banners",
            "gps",
            "rastreadores",
            "modoTesteGps",
            "controleGps",
            "prospeccao",
            "financeiro",
            "inteligencia",
            "notificacoes",
            "funcionarios",
          ].reduce(
            (acc, key) => {
              acc[key] = true;
              return acc;
            },
            {} as Record<string, boolean>,
          );

          setPermissoesUsuario(todasPermissoes);
          setTipoUsuario("admin");
          return;
        }

        setPermissoesUsuario(dados.permissoes || {});
        setTipoUsuario("funcionario");
      } catch (error) {
        console.error("Erro ao carregar permissões do menu:", error);
        setPermissoesUsuario({});
        setTipoUsuario("visitante");
      } finally {
        setCarregandoPermissoes(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const iniciais = useMemo(() => iniciaisUsuario(usuario), [usuario]);

  const principalVisivel = useMemo(() => {
    if (carregandoPermissoes && usuario) return [];
    return principal.filter((item) => permissaoAtiva(permissoesUsuario, item.permissao));
  }, [carregandoPermissoes, permissoesUsuario, usuario]);

  const adminVisivel = useMemo(() => {
    if (carregandoPermissoes && usuario) return [];
    return admin.filter((item) => permissaoAtiva(permissoesUsuario, item.permissao));
  }, [carregandoPermissoes, permissoesUsuario, usuario]);

  async function sair() {
    const auth = getAuth();
    await signOut(auth);
    navigate("/login");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#000813] text-slate-900">
      <aside className="hidden w-[275px] shrink-0 bg-[#061b32] text-white shadow-2xl md:flex md:flex-col">
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.08] text-2xl text-sky-200 ring-1 ring-white/10">
              ⚓
            </div>

            <div>
              <h1 className="text-[12px] font-black uppercase tracking-[0.18em] text-white">
                Cadê o Meu Barco
              </h1>
              <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.11em] text-sky-200/70">
                Sistema de Navegação
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-4 pb-4 pr-3 scrollbar-none">
          <div>
            <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400/70">
              Operação
            </p>
            <div className="space-y-1">
              {principalVisivel.map((item) => (
                <NavLink key={item.to} item={item} />
              ))}
            </div>
          </div>

          {adminVisivel.length > 0 && (
            <div>
              <p className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400/70">
                Gestão
              </p>
              <div className="space-y-1">
                {adminVisivel.map((item) => (
                  <NavLink key={item.to} item={item} />
                ))}
              </div>
            </div>
          )}
        </nav>

        <div className="px-4 pb-1 mt-auto">
          <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-2 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,0.12)]" />
              <span className="text-[13px] font-black text-white">
                Sistema Operacional
              </span>
            </div>
            <p className="mt-1 text-[11px] font-medium text-slate-300/80">
              Todos os serviços online
            </p>
          </div>

          <p className="mt-4 text-center text-[11px] font-semibold text-slate-400/70">
            Versão 1.1.1
          </p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[74px] shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/95 px-5 shadow-sm backdrop-blur md:px-7">
          <div className="flex min-w-0 items-center gap-4">
            <button
              type="button"
              className="hidden h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-600 transition hover:bg-slate-50 lg:flex"
              aria-label="Menu"
            >
              ≡
            </button>

            <div className="min-w-0">
              <h2 className="mt-0.5 truncate text-[22px] font-black tracking-tight text-[#0f2240] md:text-2xl">
                {tituloHeader}
              </h2>
              <p className="hidden text-[12px] font-medium text-slate-500 xl:block">
                {subtituloHeader}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 md:gap-3">
            {usuario ? (
              <>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#052a55] text-xs font-black text-white shadow-sm">
                  {iniciais}
                </div>

                <div className="hidden min-w-32 text-left lg:block">
                  <p className="truncate text-[13px] font-black text-slate-900">
                    {nomeUsuario(usuario)}
                  </p>
                  <p className="text-[11px] font-semibold text-slate-500">
                    {tipoUsuario === "admin" ? "Administrador" : "Usuário"}
                  </p>
                </div>

                <button
                  onClick={sair}
                  className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-red-600 transition hover:bg-red-100"
                >
                  Sair
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-[12px] font-black uppercase tracking-wide text-blue-700 transition hover:bg-blue-100"
              >
                Entrar
              </Link>
            )}
          </div>
        </header>
        <section className="flex-1 overflow-y-auto overflow-x-hidden bg-[#0d0c2c]">
          {children}
        </section>
      </main>
    </div>
  );
}
