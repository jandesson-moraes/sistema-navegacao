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

function itemAtivo(item: MenuItem, pathname: string) {
  return item.match?.includes(pathname) || pathname === item.to;
}

function NavLink({
  item,
  onClick,
  compacto = false,
}: {
  item: MenuItem;
  onClick?: () => void;
  compacto?: boolean;
}) {
  const location = useLocation();
  const ativo = itemAtivo(item, location.pathname);

  return (
    <Link
      to={item.to}
      onClick={onClick}
      aria-current={ativo ? "page" : undefined}
      className={[
        "group relative flex items-center gap-3 rounded-2xl font-semibold transition-all duration-200",
        compacto
          ? "min-h-[54px] px-3.5 py-3 text-[14px]"
          : "min-h-[46px] px-3 py-2.5 text-[13px]",
        ativo
          ? "bg-sky-500/[0.16] text-white shadow-[inset_4px_0_0_#38bdf8] ring-1 ring-sky-300/10"
          : "text-slate-300/85 hover:bg-white/[0.08] hover:text-white",
      ].join(" ")}
    >
      <span
        className={[
          "flex shrink-0 items-center justify-center rounded-xl font-black transition",
          compacto ? "h-9 w-9 text-[15px]" : "h-7 w-7 text-[13px]",
          ativo
            ? "bg-sky-400/[0.2] text-sky-100"
            : "bg-white/[0.06] text-slate-400 group-hover:text-sky-200",
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

function MobileBottomItem({ item }: { item: MenuItem }) {
  const location = useLocation();
  const ativo = itemAtivo(item, location.pathname);

  return (
    <Link
      to={item.to}
      aria-current={ativo ? "page" : undefined}
      className={[
        "relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-1 py-2 transition",
        ativo
          ? "bg-sky-500/[0.16] text-sky-100"
          : "text-slate-300/70 active:bg-white/[0.08]",
      ].join(" ")}
    >
      <span
        className={[
          "relative flex h-7 w-7 items-center justify-center rounded-xl text-[14px] font-black",
          ativo ? "bg-sky-300/[0.16]" : "bg-white/[0.06]",
        ].join(" ")}
      >
        {item.icon}
        {item.badge && (
          <span className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-blue-500 px-1 text-[9px] leading-4 text-white">
            {item.badge}
          </span>
        )}
      </span>
      <span className="mt-1 w-full truncate text-center text-[10px] font-black leading-none">
        {item.label}
      </span>
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
  const [menuMobileAberto, setMenuMobileAberto] = useState(false);

  useEffect(() => {
    setMenuMobileAberto(false);
  }, [location.pathname]);

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

  const menuCompletoVisivel = useMemo(
    () => [...principalVisivel, ...adminVisivel],
    [principalVisivel, adminVisivel],
  );

  const atalhosMobile = useMemo(() => {
    const prioridades = ["/gps", "/", "/embarcacoes", "/rotas"];
    const priorizados = prioridades
      .map((rota) => menuCompletoVisivel.find((item) => item.to === rota))
      .filter((item): item is MenuItem => Boolean(item));
    const restantes = menuCompletoVisivel.filter(
      (item) => !priorizados.some((priorizado) => priorizado.to === item.to),
    );

    return [...priorizados, ...restantes].slice(0, 4);
  }, [menuCompletoVisivel]);

  async function sair() {
    const auth = getAuth();
    await signOut(auth);
    setMenuMobileAberto(false);
    navigate("/login");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#000813] text-slate-900">
      <aside className="hidden w-68.75 shrink-0 bg-[#061b32] text-white shadow-2xl md:flex md:flex-col">
        <div className="px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/8 text-2xl text-sky-200 ring-1 ring-white/10">
              <img
                src="https://firebasestorage.googleapis.com/v0/b/sistema-navegacao.firebasestorage.app/o/loho%20pequena.png?alt=media&token=661b1dcd-fc5c-404a-82c9-d0f00566c2b3"
                alt="Logo"
              />
            </div>

            <div>
              <h1 className="text-[12px] font-black uppercase tracking-widest text-white">
                Cadê o Meu Barco
              </h1>
              <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.10em] text-sky-200/70">
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
      </aside>

      <div
        className={[
          "fixed inset-0 z-50 md:hidden",
          menuMobileAberto ? "pointer-events-auto" : "pointer-events-none",
        ].join(" ")}
        aria-hidden={!menuMobileAberto}
      >
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setMenuMobileAberto(false)}
          className={[
            "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-200",
            menuMobileAberto ? "opacity-100" : "opacity-0",
          ].join(" ")}
        />

        <aside
          className={[
            "absolute left-0 top-0 flex h-full w-[92vw] max-w-[385px] flex-col overflow-hidden bg-[#061b32] text-white shadow-2xl transition-transform duration-300",
            menuMobileAberto ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <div className="border-b border-white/10 px-4 pb-4 pt-[calc(18px+env(safe-area-inset-top))]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/[0.08] text-2xl text-sky-200 ring-1 ring-white/10">
                  ⚓
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-[12px] font-black uppercase tracking-[0.16em] text-white">
                    Cadê o Meu Barco
                  </h1>
                  <p className="mt-0.5 truncate text-[8px] font-bold uppercase tracking-[0.09em] text-sky-200/70">
                    Sistema de Navegação
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setMenuMobileAberto(false)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] text-xl font-black text-white active:bg-white/[0.12]"
                aria-label="Fechar menu"
              >
                ×
              </button>
            </div>

            <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.06] p-3">
              {usuario ? (
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-400/[0.16] text-sm font-black text-white ring-1 ring-sky-300/20">
                    {iniciais}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-black text-white">
                      {nomeUsuario(usuario)}
                    </p>
                    <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-100/60">
                      {tipoUsuario === "admin" ? "Administrador" : "Usuário"}
                    </p>
                  </div>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="flex min-h-[48px] items-center justify-center rounded-2xl bg-sky-500 px-4 text-sm font-black uppercase tracking-wide text-white"
                >
                  Entrar no sistema
                </Link>
              )}
            </div>
          </div>

          <nav className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-4 py-5 pb-[calc(22px+env(safe-area-inset-bottom))] scrollbar-none">
            {principalVisivel.length > 0 && (
              <div>
                <p className="mb-2 px-2 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400/80">
                  Operação
                </p>
                <div className="space-y-2">
                  {principalVisivel.map((item) => (
                    <NavLink
                      key={item.to}
                      item={item}
                      compacto
                      onClick={() => setMenuMobileAberto(false)}
                    />
                  ))}
                </div>
              </div>
            )}

            {adminVisivel.length > 0 && (
              <div>
                <p className="mb-2 px-2 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400/80">
                  Gestão
                </p>
                <div className="space-y-2">
                  {adminVisivel.map((item) => (
                    <NavLink
                      key={item.to}
                      item={item}
                      compacto
                      onClick={() => setMenuMobileAberto(false)}
                    />
                  ))}
                </div>
              </div>
            )}

            {!carregandoPermissoes && menuCompletoVisivel.length === 0 && (
              <div className="rounded-3xl border border-white/10 bg-white/[0.06] p-4 text-sm font-semibold text-sky-100/75">
                Nenhum menu liberado para este usuário.
              </div>
            )}
          </nav>

          {usuario && (
            <div className="border-t border-white/10 p-4 pb-[calc(14px+env(safe-area-inset-bottom))]">
              <button
                onClick={sair}
                className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border border-red-300/20 bg-red-500/10 px-4 text-sm font-black uppercase tracking-wide text-red-100 active:bg-red-500/20"
              >
                Sair da conta
              </button>
            </div>
          )}
        </aside>
      </div>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/95 px-3 py-2 shadow-sm backdrop-blur md:h-[74px] md:px-7 md:py-0">
          <div className="flex min-w-0 items-center gap-3 md:gap-4">
            <button
              type="button"
              onClick={() => setMenuMobileAberto(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-xl font-black text-[#0f2240] shadow-sm transition active:bg-slate-50 md:hidden"
              aria-label="Abrir menu"
              aria-expanded={menuMobileAberto}
            >
              ≡
            </button>

            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-sky-700 md:hidden">
                Painel
              </p>
              <h2 className="mt-0.5 max-w-[52vw] truncate text-[18px] font-black tracking-tight text-[#0f2240] sm:max-w-[62vw] md:max-w-none md:text-2xl">
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
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#052a55] text-xs font-black text-white shadow-sm ring-1 ring-slate-200/30">
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
                  className="hidden rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-red-600 transition hover:bg-red-100 sm:inline-flex"
                >
                  Sair
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-blue-700 transition hover:bg-blue-100 sm:px-4 sm:text-[12px]"
              >
                Entrar
              </Link>
            )}
          </div>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain bg-[#0d0c2c] pb-[96px] md:pb-0">
          {children}
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#061b32]/95 px-2 pb-[calc(8px+env(safe-area-inset-bottom))] pt-2 shadow-[0_-18px_40px_rgba(0,0,0,0.35)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-[520px] items-stretch gap-1.5 rounded-[26px] border border-white/10 bg-white/[0.055] p-1.5">
          {atalhosMobile.map((item) => (
            <MobileBottomItem key={item.to} item={item} />
          ))}

          <button
            type="button"
            onClick={() => setMenuMobileAberto(true)}
            className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-2xl px-1 py-2 text-slate-300/75 transition active:bg-white/[0.08]"
            aria-label="Abrir todos os menus"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white/[0.06] text-[15px] font-black">
              ☰
            </span>
            <span className="mt-1 w-full truncate text-center text-[10px] font-black leading-none">
              Mais
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
