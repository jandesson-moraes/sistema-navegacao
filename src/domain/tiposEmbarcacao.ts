export const TIPOS_EMBARCACAO = [
  "Barco regional",
  "Ferry boat",
  "Lancha",
  "Lancha a jato",
  "Voadeira",
  "Bote",
  "Canoa",
  "Catraia",
  "Iate",
  "Veleiro",
  "Catamarã",
  "Escuna",
  "Balsa",
  "Rebocador",
  "Empurrador",
  "Navio",
  "Houseboat",
  "Embarcação de carga",
  "Embarcação turística",
  "Outro",
] as const;

export type TipoEmbarcacao = (typeof TIPOS_EMBARCACAO)[number];
