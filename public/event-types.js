// Catálogo compartilhado pelo formulário, servidor e PDFs. As imagens são locais
// e também entram no executável, para a emissão funcionar sem internet.
export const EVENT_TYPES = [
  {
    id: "casamento",
    label: "Casamento",
    headline: "Orçamento de casamento",
    introduction: "Som, luz e uma trilha sonora para celebrar a sua história.",
    imagePath: "public/quote-assets/events/casamento.jpg",
    imageCaption: "Imagem ilustrativa de casamento. Ambientação e decoração não incluídas.",
  },
  {
    id: "debutante",
    label: "Debutantes",
    headline: "Orçamento de festa de debutante",
    introduction: "Som, luz e música para tornar seus quinze anos inesquecíveis.",
    imagePath: "public/quote-assets/events/debutante.jpg",
    imageCaption: "Imagem ilustrativa de festa de debutante. Ambientação e decoração não incluídas.",
  },
  {
    id: "aniversario",
    label: "Aniversário",
    headline: "Orçamento de aniversário",
    introduction: "Música, alegria e uma produção especial para celebrar mais um ano.",
    imagePath: "public/quote-assets/events/aniversario.jpg",
    imageCaption: "Imagem ilustrativa de aniversário. Ambientação e decoração não incluídas.",
  },
  {
    id: "formatura",
    label: "Formatura",
    headline: "Orçamento de formatura",
    introduction: "Som, iluminação e uma trilha sonora à altura desta conquista.",
    imagePath: "public/quote-assets/events/formatura.jpg",
    imageCaption: "Imagem ilustrativa de formatura. Ambientação e decoração não incluídas.",
  },
];

export function getEventType(id) {
  return EVENT_TYPES.find((eventType) => eventType.id === id);
}
