const completeEquipment =
  "04 Moving heads Beam 200\n02 Caixas de som\n02 Caixas de grave\n04 Treliças Q15\n01 Mesa controladora DJ\n01 MacBook\n02 Microfones sem fio\n01 DJ";
const complete = {
  id: "complete",
  name: "Pacote completo · DJ + som e iluminação",
  cashPrice: 2900,
  installmentPrice: 3199,
  installmentCount: 10,
  description:
    "Transporte, montagem e desmontagem incluídos no pacote completo.",
  equipment: completeEquipment,
};
const common = {
  brand: "KAIO JANSEN",
  tagline: "DJ • SONORIZAÇÃO • ILUMINAÇÃO",
  headline: "Orçamento de casamento",
  introduction: "Som, luz e uma trilha sonora para celebrar a sua história.",
  imageCaption:
    "Imagem ilustrativa da estrutura. Ambientação e decoração não incluídas.",
  reservationNotes:
    "O cronograma será combinado com a organização. Reserva mediante disponibilidade e formalização da contratação.",
};
export const QUOTE_TEMPLATES = [
  {
    ...common,
    id: "lagoa-vila-serena",
    name: "Lagoa Vila Serena",
    venue: "Lagoa Vila Serena",
    description: "Proposta com pacote completo, valores à vista e parcelado.",
    offers: [{ ...complete }],
  },
  {
    ...common,
    id: "castelli-mondini",
    name: "Castelli Mondini",
    venue: "Castelli Mondini • Ascurra/SC",
    description: "Pacote completo e opções de iluminação, DJ e cerimônia.",
    offers: [
      { ...complete },
      {
        id: "lighting",
        name: "Somente iluminação",
        cashPrice: 1900,
        installmentPrice: 2199,
        installmentCount: 0,
        description:
          "Condições de parcelamento e composição técnica a combinar.",
        equipment:
          "Serviço de iluminação. Equipamentos e estrutura a confirmar com a contratada.",
      },
      {
        id: "dj",
        name: "Somente DJ",
        cashPrice: 1200,
        installmentPrice: null,
        installmentCount: 0,
        description:
          "Somente atuação do DJ, sem som, iluminação ou equipamentos. Pagamento a combinar.",
        equipment: "01 DJ\nSem som, iluminação ou equipamentos.",
      },
      {
        id: "ceremony",
        name: "Kit cerimônia externa",
        cashPrice: 1000,
        installmentPrice: null,
        installmentCount: 0,
        description: "Composição técnica e pagamento a combinar.",
        equipment:
          "Kit para cerimônia externa. Equipamentos a confirmar com a contratada.",
      },
    ],
  },
  {
    ...common,
    id: "gottesgabe-eventos",
    name: "Gottesgabe Eventos",
    venue: "Gottesgabe Eventos • Gaspar/SC",
    description: "Proposta com pacote completo para Gottesgabe Eventos.",
    offers: [{ ...complete }],
  },
];
export function getQuoteTemplate(id) {
  return QUOTE_TEMPLATES.find((t) => t.id === id);
}
export function dateBeforeEvent(value, days = 10) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return "";
  const d = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
