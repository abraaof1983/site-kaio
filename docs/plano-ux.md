# Plano de melhoria de UX · AOF Studio

Avaliação de 19/10/2026 · Escopo: interface web (`public/`), PDFs (`quote-pdf.js`, `server.js`) e iniciador do Windows.

## 1. Resumo

O sistema já resolve o essencial: cadastro, orçamento com modelo visual, conversão em contrato e PDF com identidade forte. Os problemas de UX se concentram em quatro pontos:

1. O formulário de orçamento é longo, vem com valores pré-preenchidos que induzem a erro e pode perder o que foi digitado.
2. O fluxo comercial depende de status manuais e não acompanha o que acontece depois do envio.
3. Legibilidade e acessibilidade ficam abaixo do WCAG 2.2 AA.
4. A experiência no celular, canal principal do cliente brasileiro, quebra nas listas e nos formulários.

Principais evidências, medidas em telas reais com dados fictícios:

- "＋ Novo orçamento" abre com o modelo Lagoa Vila Serena, o local "Lagoa Vila Serena" e o último cliente cadastrado já selecionados.
- O formulário tem 26 campos em um único modal: 3,6 telas de rolagem no notebook (1366×768) e 4,2 no celular. Esc fecha sem confirmar.
- Em Orçamentos, nenhuma linha da lista aparece sem rolar em 1366×768: a galeria de modelos ocupa a primeira tela.
- 49% dos textos do painel não atingem o contraste mínimo de 4,5:1 e 46% têm menos de 12 px.
- No celular, a tabela mostra 42% da largura: situação, valor e ações ficam fora da tela.
- Um orçamento com validade vencida (30/09/2026) continua "Enviado"; um orçamento já convertido segue com o botão "→ Contrato".

| Fase | Foco | Duração estimada* |
|---|---|---|
| 0 · Correções rápidas | Prevenção de erros, contraste, status vencido, proteção do que foi digitado | 2 a 3 semanas |
| 1 · Navegação e listas | Endereço por tela, lista em primeiro plano, filtros, ações, celular, envio por WhatsApp | 2 a 4 semanas |
| 2 · Editor e fluxo comercial | Editor em etapas com prévia, catálogo único, plano de pagamento, status por ação, painel útil | 6 a 10 semanas |
| 3 · Experiência do cliente | Hospedagem, aceite online, assinatura eletrônica, Pix, questionário do evento | 8 semanas ou mais |

*Estimativas para uma pessoa desenvolvedora; refinar ao final da Fase 0.

Andamento: a Fase 0 foi concluída. Veja a seção 11.

## 2. O que já funciona bem (manter)

- Interface toda em português, com tom acolhedor e estados vazios que orientam e oferecem a próxima ação.
- Cada documento guarda um retrato dos dados da empresa e do cliente na emissão: alterar o cadastro depois não muda propostas já enviadas.
- Conversão idempotente: o mesmo orçamento não gera dois contratos.
- Autorização de imagem começa desmarcada (privacidade por padrão).
- Todos os campos têm rótulo associado; o modal usa `<dialog>` nativo, com foco preso e tecla Esc.
- PDF do orçamento com identidade visual forte, valores à vista e parcelado lado a lado, opção selecionada em destaque e alternativas em página separada, sem somar valores.
- Contrato em rascunho sai com aviso de revisão antes da assinatura.

## 3. Como a avaliação foi feita

- Avaliação heurística com as 10 heurísticas de Nielsen (N1 a N10) e severidade de 1 a 4.
- Medições automáticas no navegador (Chrome sem interface) em uma instância isolada do servidor, com banco temporário e dados fictícios; o banco real em `data/` não foi usado. Foram medidos contraste de cada texto visível, tamanho de fonte, tamanho dos alvos clicáveis, quantidade de campos e altura dos formulários, em 1366×768 (notebook comum) e 390×844 (celular).
- Percurso das tarefas principais: criar orçamento por modelo, corrigir parcelas, converter em contrato, revisar cláusulas e gerar os PDFs.
- Leitura de `app.js`, `style.css`, `server.js`, `quote-pdf.js`, `quote-templates.js` e do iniciador.
- As capturas estão em `.cache/ux-audit/shots/` (fora do Git).
- Limites: não houve teste com usuários nem com leitor de tela. A medição de contraste é automática e aproximada. Conformidade com o WCAG exige teste manual com tecnologias assistivas e revisão especializada.

## 4. Diagnóstico

Severidade: 4 = crítico (causa erro ou perda de dados) · 3 = alto · 2 = médio · 1 = baixo.

Heurísticas: N1 visibilidade do status · N2 linguagem do mundo real · N3 controle e liberdade · N4 consistência · N5 prevenção de erros · N6 reconhecer em vez de lembrar · N7 eficiência · N8 design minimalista · N9 recuperação de erros.

### A. Criação de orçamento e contrato

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| A1 | Valores pré-preenchidos sem escolha do usuário | "＋ Novo orçamento" seleciona `templates[0]` (Lagoa Vila Serena, com o local) e `state.clients[0]` (último cliente cadastrado) em `editDoc`. Risco de proposta para o cliente ou local errado | N5 | 4 |
| A2 | Perda do que foi digitado | Esc, × e Cancelar fecham o modal sem confirmar; não há rascunho automático; sessão expirada durante a edição só mostra um erro | N3, N5 | 4 |
| A3 | Formulário longo dentro de modal | 26 campos (8 obrigatórios): 3,6 telas em 1366×768 e 4,2 no celular; cabeçalho e botão Salvar rolam junto com o conteúdo | N8 | 3 |
| A4 | Pagamento com conceitos sobrepostos | Valor à vista, total parcelado, nº de parcelas ("0 = a combinar"), condição escolhida, condições do cartão, total somente leitura, vencimentos e texto livre: cerca de 11 controles, e o texto de ajuda precisa explicar exceções | N2, N6 | 3 |
| A5 | Erro tardio e longe do campo | A soma das parcelas só é validada no servidor; a mensagem aparece em 12 px no fim do formulário, sem destacar o campo, e não há soma em tempo real | N9, WCAG 3.3.1 | 3 |
| A6 | Entrada sem formato brasileiro | Valores como "2900" e "1350" sem máscara R$; "Convidados" aceita centavos (`step=0.01`); CPF/CNPJ, telefone e CEP sem máscara nem validação | N4, N5 | 2 |
| A7 | Obrigatoriedade inconsistente | Selects obrigatórios (Cliente) sem asterisco; "Validade" obrigatória sem valor padrão; rótulo "Identidade do documento" sem campo | N4 | 2 |
| A8 | Cláusulas em caixa pequena | 2.541 caracteres em uma área de 100 px de altura, no contrato e em Configurações | N7 | 2 |

### B. Fluxo comercial

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| B1 | Status manuais e iguais para orçamento e contrato | Rascunho, Enviado, Aprovado, Assinado e Cancelado servem aos dois; não há Recusado nem Vencido. Orçamento com validade 30/09/2026 aparece "Enviado" em 19/10/2026 | N1, N2 | 3 |
| B2 | Conversão sem continuidade | Depois de gerar o contrato, o orçamento segue "Aprovado" e com o botão "→ Contrato"; um novo clique mostra "Contrato criado" e devolve o mesmo; o contrato não abre para revisão | N1, N4 | 3 |
| B3 | Contrato assinado continua editável | Nenhum bloqueio, aviso ou versão depois de "Assinado" | N5 | 3 |
| B4 | Não dá para excluir, arquivar ou duplicar | Não há rota de exclusão no servidor; eventos parecidos exigem redigitar tudo | N3, N7 | 3 |
| B5 | Numeração difícil de comunicar | `OR-2026-EC9CEE` é aleatória, não indica ordem e é ruim de ditar por telefone ou WhatsApp | N2 | 2 |
| B6 | Sem alerta de data ocupada | Nada avisa quando a data já tem contrato; risco de reservar duas vezes o mesmo sábado | N5 | 2 |
| B7 | Duas fontes de preço | Os "modelos visuais" são, na prática, predefinições de local + pacote + preço fixas no código (R$ 2.900/3.199) que não aparecem em "Pacotes e preços" (R$ 2.700). Com modelo ativo, o pacote de referência fica desabilitado | N2, N4 | 2 |
| B8 | Marca fixa no código | Nome "KAIO JANSEN", logo e foto dos modelos valem para qualquer conta; o contrato usa "AOF Serviços" com outro visual | N4 | 2 |

### C. Navegação e listas

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| C1 | Sem endereço por tela | A tela atual fica só em memória: F5 volta para a Visão geral, Voltar do navegador sai do sistema e não existe link direto para um documento; o título da aba é o mesmo em todas as telas | N3, WCAG 2.4.2 | 3 |
| C2 | Lista abaixo da dobra | Em Orçamentos, a galeria ocupa a primeira tela: em 1366×768 a busca e a lista começam fora da área visível. Os três cards usam a mesma foto e o mesmo logo | N8 | 3 |
| C3 | Ações pesadas por linha | 4 botões de 10 px por linha, que quebram em duas linhas; a linha não é clicável; não existe tela de detalhe do documento | N7, N8 | 2 |
| C4 | Filtros e estados vazios | Sem abas por status com contagem, sem ordenação, sem número e validade na tabela; busca sem resultado oferece "Criar primeiro orçamento", inclusive em Contratos, em vez de "Limpar filtros" | N9 | 2 |
| C5 | Escolha de cliente | `<select>` simples, que não escala; cadastrar cliente novo tira o usuário do fluxo (troca de página e abre outro modal) | N7 | 2 |
| C6 | Decoração competindo com conteúdo | "ORGANIZAÇÃO QUE DÁ O TOM" em todas as páginas; "Tudo pronto para o próximo evento" com ponto verde parece status do sistema; avatar duplicado; rodapé e dica fixos no painel | N8 | 1 |

### D. Painel (Visão geral)

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| D1 | Indicadores pouco acionáveis | "Contratos emitidos" soma rascunhos e cancelados (03 no teste, com 1 assinado); sem período; nada sobre orçamentos a vencer, sem resposta, parcelas a receber ou taxa de conversão | N1 | 2 |
| D2 | Ação principal invertida | "Novo contrato" é o botão primário, mas o fluxo recomendado começa pelo orçamento | N4 | 2 |
| D3 | Agenda limitada | "Próximos eventos" mostra 3 contratos, sem calendário nem "ver todos" | N7 | 1 |

### E. Acessibilidade e legibilidade (WCAG 2.2 AA)

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| E1 | Contraste de texto insuficiente | 60 de 123 textos do painel (49%) e 42 de 91 em Orçamentos (46%) abaixo do mínimo. Cinza secundário `#82908c` = 3,32:1; rótulos `#929d96` = 2,61:1; itens do menu `#76817d` = 4,03:1 | WCAG 1.4.3 | 3 |
| E2 | Texto pequeno demais | 56 de 123 textos do painel abaixo de 12 px; tabelas entre 10 e 12 px, etiquetas com 9 px e numeração dos modelos com 8 px | Legibilidade | 3 |
| E3 | Campos e foco pouco visíveis | Borda dos campos com 1,30:1 e contorno de foco com 1,21:1 (mínimo 3:1) | WCAG 1.4.11 | 2 |
| E4 | Alvos pequenos | Botão Sair com 12×19 px e "Ver contratos" com 15 px de altura; 26 de 32 alvos do painel abaixo dos 44 px recomendados para toque | WCAG 2.5.8 | 2 |
| E5 | Mudança de tela não comunicada | Cada ação recria a página com `innerHTML` e o foco se perde; sem link "Pular para o conteúdo"; sem `aria-current` no menu; símbolos decorativos (✳ ◇ ▤ ♧) lidos pelo leitor de tela; erros em aviso que some em 3,5 s | WCAG 2.4.1, 2.4.3, 4.1.3 | 2 |
| E6 | Login | Sem `autocomplete` (atrapalha gerenciadores de senha), sem "mostrar senha", sem recuperação de senha e sem indicação de carregamento | WCAG 1.3.5 | 2 |

### F. Celular

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| F1 | Tabela cortada | 286 de 679 px visíveis (42%); situação, valor e ações exigem rolagem lateral; linhas com cerca de 160 px de altura | N8 | 3 |
| F2 | Menu sem rótulos | Barra lateral de 76 px só com ícones (20% da largura em 390 px); textos de busca e filtro truncados ("Buscar por non") | N6 | 2 |
| F3 | Formulário extenso | 4,2 telas de rolagem para um orçamento | N8 | 2 |

### G. PDFs entregues ao cliente

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| G1 | Status interno no documento do cliente | O orçamento imprime "Enviado"; o contrato imprime "Assinatura informada manualmente" | N2 | 2 |
| G2 | Dados pessoais além do necessário | O orçamento mostra CPF e endereço do cliente; numa proposta, nome e evento bastam (princípio da necessidade, LGPD art. 6º, III) | LGPD | 2 |
| G3 | Falta o próximo passo | O orçamento não diz como aceitar (WhatsApp, link, Pix); o telefone da empresa vem vazio por padrão, e o rodapé mostra só o e-mail | N1 | 2 |
| G4 | Identidades diferentes e impressão | Orçamento escuro "KAIO JANSEN" e contrato branco "AOF Serviços"; fundo escuro em página inteira gasta muita tinta ao imprimir | N4 | 2 |
| G5 | Acabamento do contrato | Cláusulas em texto corrido, assinaturas alinhadas com espaços e sublinhados, numeração de página no meio do rodapé, sem local e data | N8 | 1 |

### H. Ambiente de execução

| ID | Problema | Evidência | Ref. | Sev. |
|---|---|---|---|---|
| H1 | Inicialização lenta e frágil | `iniciar-windows.cmd` reinstala as dependências (`npm ci`) a cada abertura, o que é lento e, segundo o README, depende de internet; a janela precisa ficar aberta; o navegador não abre sozinho; há cópias não versionadas (`iniciarSistema.bat` e `.txt`) | N7 | 2 |
| H2 | Celular e backup | Sem hospedagem com HTTPS, o celular só acessa na mesma rede; o backup é manual (copiar `data/` com o servidor parado) | N7 | 2 |

## 5. Benchmarks

| Referência | O que o mercado faz | O que adotar aqui |
|---|---|---|
| [HoneyBook](https://help.honeybook.com/en/articles/9778720-glossary-files-and-templates) | Um documento em etapas no qual o cliente escolhe o serviço, assina o contrato e paga de uma vez | Página da proposta: escolher opção → aceitar → assinar → pagar o sinal |
| [Check Cherry](https://www.checkcherry.com/articles/227-what-to-look-for-in-dj-crm-software-13-must-have-features) (software para DJs) | O evento é um registro único (data, local, horários, pacotes, adicionais, plano de pagamento, portal); conflitos de agenda são bloqueados; o cliente preenche músicas e cronograma no portal; lembretes de saldo saem sozinhos | Evento como centro do sistema; alerta de data ocupada; questionário do evento |
| [Proposify, 742 mil propostas (2026)](https://www.proposify.com/blog/sales-closing-statistics) | Com assinatura eletrônica, fechamento 15% maior e 60% mais rápido; pré-assinadas pela contratada, +65%; preço interativo, 2× mais propostas ganhas; vencedoras são enxutas (média de 11 páginas e 7 seções); gestão de eventos leva cerca de 12 dias para fechar | Assinatura integrada com a contratada assinando antes; adicionais selecionáveis; lembretes de acompanhamento |
| [Proposify, personalização](https://www.proposify.com/blog/proposal-design-best-practices) | Personalizar cerca de 30% da apresentação para cada cliente eleva o fechamento em 50% | Apresentação com nomes, data e local do casal no lugar do texto padrão |
| [Conta Azul](https://ajuda.contaazul.com/hc/pt-br/articles/7407294646157-Or%C3%A7amentos-como-criar) | Orçamento com status aceito, recusado ou venda e [relatório do funil orçamento → venda](https://ajuda.contaazul.com/hc/pt-br/articles/28354467637901-Relat%C3%B3rios-de-vendas-quais-s%C3%A3o-os-relat%C3%B3rios-para-an%C3%A1lise-de-vendas-e-or%C3%A7amentos) | Status por tipo de documento e taxa de conversão no painel |
| [WizGestor](https://wizgestor.com/recursos/orcamentos) | O cliente responde pelo link sem criar conta (aceita, recusa ou contrapropõe); aprovado, o orçamento vira cobrança ou pedido | Aceite online e pedido de ajuste |
| [Stripe Invoicing](https://docs.stripe.com/changelog/2020-03-02/sequentially-number-invoices) | Numeração sequencial configurável para toda a conta | `OR-2026-0001`, `CT-2026-0001` |
| [ZapSign](https://docs.zapsign.com.br/) | Assinatura com base na MP 2.200-2/2001, [API com webhooks](https://blog.zapsign.com.br/zapsign-api/), envio e lembretes por WhatsApp | Status "Assinado" automático, sem marcação manual |
| [Baymard Institute](https://baymard.com/research-articles/checkout-flow-average-form-fields) | O número de campos pesa mais que o número de etapas; [32% dos sites não validam campos em tempo real](https://baymard.com/research-articles/inline-form-validation); [só 14% marcam obrigatórios e opcionais](https://baymard.com/blog/required-optional-form-fields) | Etapas curtas, validação no campo, marcação de opcionais |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [GOV.UK](https://design-system.service.gov.uk/components/error-summary/) e [GOV.BR DS](https://www.gov.br/ds/) | Contraste 4,5:1, [alvos de 24×24 px](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum), título por página, resumo de erros com links para os campos | Paleta, tipografia e componentes acessíveis |

Contexto brasileiro que orienta as prioridades:

- O WhatsApp está em [98% dos celulares](https://santini.global/uso-whatsapp-brasileiros/) (Panorama Mobile Time/Opinion Box, mar/2024): é o canal de envio e de aceite.
- [88,9% das pessoas com 10 anos ou mais têm celular](https://www.cnnbrasil.com.br/economia/celular-avanca-entre-idosos-e-na-area-rural-e-quase-90-da-populacao-do-pais-tem-aparelho/) (IBGE, PNAD TIC 2024): o cliente vai abrir a proposta no telefone.
- O Pix respondeu por [50,9% das transações no 1º semestre de 2025](https://g1.globo.com/economia/pix/noticia/2025/11/10/transacoes-via-pix-subiram-276percent-no-1o-semestre-de-2025-e-responderam-por-mais-da-metade-do-total-diz-bc.ghtml) (Banco Central): sinal e parcelas devem ter Pix como padrão.

Leitura dos números: os dados da Proposify vêm da base do próprio fornecedor. Servem como direção, não como promessa de resultado.

## 6. Plano de ação

Esforço: P = algumas horas · M = 1 a 3 dias · G = 1 a 3 semanas.

### Fase 0 · Correções rápidas (2 a 3 semanas)

| # | Ação | Resolve | Onde | Esforço | Pronto quando |
|---|---|---|---|---|---|
| 0.1 | "Novo orçamento" sem modelo, local ou cliente pré-selecionados; o campo Cliente começa em "Selecione o cliente" | A1 | `app.js` (`editDoc`) | P | Nada de cliente ou local vem preenchido sem escolha explícita |
| 0.2 | Perguntar "Descartar alterações?" em Esc, × e Cancelar quando houver mudanças; rascunho automático no navegador; sessão expirada reabre o login sem perder o formulário | A2 | `app.js` (`openModal`, `api`) | M | Fechar com alterações pede confirmação; recarregar oferece restaurar |
| 0.3 | Cabeçalho e rodapé fixos no modal, com rolagem só no corpo | A3 | `style.css` | P | "Salvar" sempre visível |
| 0.4 | Soma das parcelas em tempo real ("Faltam R$ 1.250,00"), botão "Distribuir igualmente", erro junto ao campo com `aria-invalid` e resumo de erros no topo | A5 | `app.js` | M | O erro aparece antes de enviar, ao lado do campo |
| 0.5 | Máscara R$ nos valores (`inputmode="decimal"`); "Convidados" só com inteiros; máscaras de CPF/CNPJ e telefone; asterisco também nos selects obrigatórios | A6, A7 | `app.js` (`field`, `select`) | M | Valores exibidos como R$ 2.900,00 |
| 0.6 | Paleta e escala tipográfica da seção 9: texto secundário ≥ 4,5:1, mínimo de 12 px, bordas e foco ≥ 3:1, botões com 44 px de altura | E1 a E4 | `style.css` | M | Medição automática sem falhas de contraste |
| 0.7 | Status "Vencido" calculado pela validade; validade padrão de 15 dias (configurável); aviso "vence em 3 dias" | B1 | `app.js`, Configurações | P | O orçamento vencido do teste aparece como "Vencido" |
| 0.8 | Depois de gerar o contrato: orçamento marcado "Convertido", com link "Ver contrato", sem o botão de conversão, e contrato aberto para revisão | B2 | `app.js`, `server.js` | P | Um clique leva do orçamento ao contrato |
| 0.9 | Título da aba por tela, `aria-current` no menu, link "Pular para o conteúdo", foco no título após trocar de tela, símbolos com `aria-hidden`, erros persistentes com `role="alert"` e botão fechar | E5 | `app.js` | P | Navegação completa por teclado sem perder o foco |
| 0.10 | Login com `autocomplete`, "mostrar senha" e indicação de carregamento | E6 | `app.js` (`auth`) | P | O gerenciador de senhas preenche e salva |
| 0.11 | Tirar frases decorativas repetidas e o falso status da barra superior; "Novo orçamento" como ação primária do painel; "Contratos emitidos" sem rascunhos e cancelados | C6, D1, D2 | `app.js` | P | A primeira dobra mostra só informação útil |
| 0.12 | PDFs sem status interno; orçamento sem CPF e endereço, com bloco "Como contratar" (WhatsApp e Pix); WhatsApp obrigatório em Configurações | G1 a G3 | `quote-pdf.js`, `server.js` | P | O cliente entende o próximo passo lendo só o PDF |
| 0.13 | Iniciador: `npm ci` só quando `node_modules` faltar ou o `package-lock.json` mudar; abrir o navegador automaticamente; um único arquivo de início | H1 | `iniciar-windows.cmd` | P | Abre sem internet depois da primeira instalação |

### Fase 1 · Navegação, listas e celular (2 a 4 semanas)

| # | Ação | Resolve | Esforço | Pronto quando |
|---|---|---|---|---|
| 1.1 | Endereço por tela (`#/orcamentos`, `#/orcamentos/123`, `#/clientes/45`) com histórico do navegador | C1 | M | F5 e Voltar funcionam; um link abre o documento certo |
| 1.2 | Lista em primeiro lugar: modelos viram a primeira etapa do "Novo orçamento" ou uma faixa recolhível | C2 | P | 5 linhas ou mais visíveis em 1366×768 |
| 1.3 | Abas com contagem (Todos · Rascunhos · Enviados · Aceitos · Vencidos · Convertidos), ordenação por data do evento, colunas Nº e Validade, busca por número e "Limpar filtros" no estado vazio | C4 | M | Achar "enviados de dezembro sem resposta" em 2 cliques |
| 1.4 | Uma ação principal por linha + menu "⋯" (Visualizar PDF, Baixar, Duplicar, Gerar contrato, Arquivar); a linha abre a tela do documento com resumo, histórico e ações | C3 | M | Linhas com altura única e uma ação clara |
| 1.5 | Arquivar e excluir com "Desfazer"; duplicar documento | B4 | M | Duplicar cria rascunho com data e cliente em branco |
| 1.6 | Celular: lista em cartões (cliente, evento, data, valor, status, ação), barra inferior com rótulos e botão "Novo" | F1, F2 | M | Nenhuma rolagem lateral em 390 px |
| 1.7 | Cliente com busca e "＋ Novo cliente" dentro do campo; tela do cliente com histórico de eventos e documentos | C5 | M | Orçamento para cliente novo sem sair do formulário |
| 1.8 | "Enviar por WhatsApp": abre a conversa do cliente com mensagem pronta (o PDF vai como anexo até existir a página pública) e registra "Enviado em" | B1, G3 | P | Status "Enviado" sem marcação manual |

### Fase 2 · Editor e fluxo comercial (6 a 10 semanas)

| # | Ação | Resolve | Esforço | Pronto quando |
|---|---|---|---|---|
| 2.1 | Editor em página inteira com 3 etapas (Cliente e evento → Serviços e valores → Pagamento e condições), salvamento automático e prévia do PDF ao lado (aba "Prévia" no celular) | A3, F3 | G | Até 10 campos por etapa; a prévia acompanha a digitação |
| 2.2 | Catálogo único: modelos usam os pacotes de "Pacotes e preços"; adicionais com preço (hora extra, cerimônia externa, iluminação) marcados por caixa de seleção | B7 | G | Mudar um preço em um lugar vale para os novos orçamentos |
| 2.3 | Plano de pagamento com opções prontas: "À vista no Pix", "Sinal 30% + saldo até 10 dias antes", "Cartão em até 10x", "Personalizado", com parcelas geradas automaticamente | A4 | M | Os 6 campos de preço viram 1 escolha + ajuste opcional |
| 2.4 | Status por tipo e por ação. Orçamento: Rascunho → Enviado → Aceito, Recusado ou Vencido → Convertido. Contrato: Rascunho → Aguardando assinatura → Assinado → Realizado ou Cancelado. Cada transição registra a data | B1 | M | Ninguém escolhe status em lista suspensa |
| 2.5 | Contrato assinado em modo leitura, com "Criar aditivo" ou nova versão e histórico de alterações | B3 | M | Editar um contrato assinado exige nova versão |
| 2.6 | Numeração sequencial por conta e ano | B5 | P | `OR-2026-0001` |
| 2.7 | Aviso de data ocupada ao escolher a data do evento | B6 | P | Data com contrato mostra alerta com link |
| 2.8 | Cláusulas em lista (ativar, desativar, reordenar, expandir) com variáveis de cliente, data e local | A8 | M | Revisar o contrato sem rolar dentro de uma caixa de 100 px |
| 2.9 | Identidade por conta em Configurações (nome comercial, logo, foto, cores) aplicada a orçamento e contrato; versão clara para impressão; contrato com cláusulas formatadas e bloco de assinatura com local, data, nome e documento das partes (validar com assessoria jurídica) | B8, G4, G5 | G | Outra conta gera PDFs com a própria marca |
| 2.10 | CEP e CNPJ com preenchimento automático ([BrasilAPI](https://brasilapi.com.br/) ou [ViaCEP](https://viacep.com.br/)) e validação de CPF/CNPJ | A6 | M | Endereço preenchido a partir do CEP |
| 2.11 | Recebimentos: marcar parcela como paga, lista "A receber" e atrasadas | D1 | M | Saber quanto entra no mês sem planilha |
| 2.12 | Painel "Precisa de você" (vencendo, sem resposta há 5 dias, aguardando assinatura, parcelas da semana), funil de conversão, tempo de fechamento, receita prevista e agenda mensal com exportação para o Google Agenda | D1, D3 | M | O painel responde "o que faço hoje?" |

### Fase 3 · Experiência do cliente final (8 semanas ou mais)

| # | Ação | Resolve | Esforço |
|---|---|---|---|
| 3.1 | Hospedagem com HTTPS, backup automático e instalação como app no celular (PWA) | H2 | M |
| 3.2 | Página pública da proposta, pensada para celular e enviada por WhatsApp: o cliente escolhe opção e adicionais, aceita ou pede ajuste; registro de "Visualizado" | G3, B1 | G |
| 3.3 | Assinatura eletrônica integrada (por exemplo, API da ZapSign com webhooks), com a contratada assinando antes | B3 | G |
| 3.4 | Pix na proposta e no contrato: QR code estático com valor (gerado sem integração bancária) e "copia e cola"; lembretes automáticos de vencimento | D1 | M |
| 3.5 | Questionário do evento para o cliente: músicas obrigatórias e proibidas, momentos e cronograma da festa | Diferencial de nicho | G |

## 7. Metas e métricas

| Métrica | Hoje (medido em 19/10/2026) | Meta |
|---|---|---|
| Textos abaixo de 4,5:1 no painel | 60 de 123 (49%) | 0 |
| Textos abaixo de 12 px no painel | 56 de 123 | 0 |
| Campos no "Novo orçamento" | 26, em um modal de 3,6 telas | Até 10 por etapa, 1 tela por etapa |
| Linhas visíveis da lista em 1366×768 (Orçamentos) | 0 | 5 ou mais |
| Largura visível da lista no celular | 42% | 100% |
| Alvos abaixo de 24 px | 2 | 0 |
| Tempo para criar um orçamento | medir antes da Fase 0 | menos de 3 minutos |
| Conversão orçamento → contrato | medir (os dados já existem) | acompanhar mês a mês |
| Orçamentos vencidos sem resposta | não medido | queda mês a mês |
| SUS (System Usability Scale) | medir antes da Fase 0 | 80 ou mais (a média de mercado é 68) |

## 8. Como validar

- Teste de usabilidade com 5 pessoas ([NN/g](https://www.nngroup.com/articles/why-you-only-need-to-test-with-5-users/)) antes e depois de cada fase: o próprio DJ, alguém da equipe e 3 clientes ou cerimonialistas. Tarefas: criar orçamento Castelli para um cliente novo; corrigir as parcelas; gerar e revisar o contrato; encontrar os eventos de dezembro; abrir a proposta no celular.
- Repetir as medições automáticas a cada versão (axe DevTools ou Lighthouse) e testar com teclado e com o leitor de tela NVDA.
- A partir da Fase 2, acompanhar os números de negócio da seção 7 no próprio painel.

## 9. Base visual sugerida

Valores conferidos contra os fundos atuais (`#ffffff` e `#f5f7f6`):

```css
:root {
  /* Texto */
  --text: #263b39;           /* 11,05:1 */
  --text-muted: #5c6b66;     /* 5,60:1 no branco · 5,20:1 no fundo */
  /* Componentes: WCAG 1.4.11 exige 3:1 */
  --border-input: #7f8d88;   /* 3,46:1 */
  --primary: #13796b;        /* 5,28:1 com texto branco */
  --danger: #b03a2e;         /* 6,02:1 */
  /* Etiquetas de status (texto / fundo) */
  --badge-draft: #4a5852;   --badge-draft-bg: #edf0ed;   /* 6,51:1 */
  --badge-sent: #3b4a80;    --badge-sent-bg: #eef0fa;    /* 7,46:1 */
  --badge-ok: #25654a;      --badge-ok-bg: #e6f2ea;      /* 6,01:1 */
  --badge-late: #7a4d00;    --badge-late-bg: #fdf1dc;    /* 6,50:1 */
  --badge-cancel: #8a3a2f;  --badge-cancel-bg: #fbeae7;  /* 6,61:1 */
  /* Tipografia */
  --fs-caption: 12px;  --fs-small: 14px;  --fs-body: 16px;
  --fs-h3: 18px;       --fs-h2: 22px;     --fs-h1: 28px;
  /* Alvo de toque recomendado (o WCAG exige no mínimo 24 px) */
  --target-min: 44px;
}
:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
```

## 10. Riscos e decisões

- Segurança: página pública, links enviados e acesso pelo celular exigem hospedagem com HTTPS e deixam o servidor acessível pela internet. Pedem links com token longo e validade, limite de tentativas persistente (hoje o limite de login fica em memória), `COOKIE_SECURE=true` e backup.
- Jurídico: cláusulas, aditivos e assinatura eletrônica precisam de validação com assessoria jurídica antes do uso.
- Arquitetura: o front-end é JavaScript puro e recria a tela inteira a cada ação. As Fases 0 e 1 cabem nesse modelo; o editor com prévia ao vivo (2.1) fica mais simples com uma biblioteca leve de componentes (Preact ou Lit). Decidir antes da Fase 2.
- Dados: tornar o "evento" a entidade central, como no Check Cherry, exige migrar os registros sem quebrar o retrato dos documentos já emitidos.

## 11. Andamento

### Fase 0 · implementada

| # | Situação | Observação |
|---|---|---|
| 0.1 | Feito | "Novo orçamento" abre sem modelo, sem local e com "Selecione o cliente" |
| 0.2 | Feito | Confirmação em Esc, × e Cancelar, ao sair de Configurações e ao recarregar a página; rascunho no navegador para orçamento e contrato; sessão expirada pede a senha e conclui o salvamento |
| 0.3 | Feito | Só o corpo do modal rola |
| 0.4 | Feito | Soma em tempo real, "Distribuir o total igualmente", erro no campo e resumo de erros com links |
| 0.5 | Feito | A máscara de CPF/CNPJ aceita CNPJ alfanumérico (texto com letras fica como foi digitado) |
| 0.6 | Feito | Ações das linhas com 32 px de altura (acima dos 24 px do WCAG); demais botões e campos com 44 px; campos com 16 px de fonte |
| 0.7 | Feito | Situação "Vencido" calculada; validade padrão configurável em Configurações |
| 0.8 | Feito | "Convertido" e "Ver contrato" calculados pelo vínculo com o contrato; o contrato gerado abre para revisão |
| 0.9 | Feito | Título da aba, `aria-current`, link "Pular para o conteúdo", foco no título, avisos de erro persistentes |
| 0.10 | Feito | Recuperação de senha continua fora do escopo |
| 0.11 | Feito | Painel com "Contratos ativos" no lugar de "Contratos emitidos" |
| 0.12 | Feito | O contrato mantém só os avisos de rascunho e cancelado |
| 0.13 | Feito | Instala só quando precisa e abre o navegador; as cópias locais `iniciarSistema.bat` e `iniciarSistema.txt` foram removidas |

Correção encontrada durante a implementação: ao editar um contrato gerado de um orçamento, o sistema apagava o vínculo com o orçamento de origem e a condição de pagamento do modelo. Um novo clique em "→ Contrato" criava um contrato duplicado. Agora os campos que não estão no formulário são preservados.

Medições depois da Fase 0, com as mesmas telas e dados fictícios:

| Métrica | Antes | Depois |
|---|---|---|
| Textos abaixo de 4,5:1 no painel | 60 de 123 | 0 de 109 |
| Textos abaixo de 12 px no painel | 56 de 123 | 0 |
| Alvos abaixo de 24 px | 2 | 0 |
| "Novo orçamento" com local e cliente pré-preenchidos | Sim | Não |
| Erro na soma das parcelas | Só depois de enviar, no fim do formulário | No campo, antes de enviar, com resumo no topo |
| Fonte dos campos no celular | 14 px (o iPhone dá zoom) | 16 px |

Continuam para as próximas fases: o tamanho do formulário (3,5 telas; item 2.1), a lista abaixo da dobra em Orçamentos (1.2) e a tabela cortada no celular (1.6).

## Fontes

- [Nielsen Norman Group: 10 heurísticas de usabilidade](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [W3C: WCAG 2.2](https://www.w3.org/TR/WCAG22/) e [entendendo o critério 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- [GOV.UK Design System: resumo de erros](https://design-system.service.gov.uk/components/error-summary/) · [Padrão Digital de Governo (GOV.BR DS)](https://www.gov.br/ds/)
- Baymard Institute: [campos no checkout](https://baymard.com/research-articles/checkout-flow-average-form-fields), [validação em tempo real](https://baymard.com/research-articles/inline-form-validation), [obrigatórios e opcionais](https://baymard.com/blog/required-optional-form-fields)
- Proposify: [estatísticas de fechamento 2026](https://www.proposify.com/blog/sales-closing-statistics), [design de propostas](https://www.proposify.com/blog/proposal-design-best-practices)
- [HoneyBook: smart files](https://help.honeybook.com/en/articles/9778720-glossary-files-and-templates) · [Check Cherry: recursos para DJs](https://www.checkcherry.com/articles/227-what-to-look-for-in-dj-crm-software-13-must-have-features)
- Conta Azul: [orçamentos](https://ajuda.contaazul.com/hc/pt-br/articles/7407294646157-Or%C3%A7amentos-como-criar), [relatório do funil](https://ajuda.contaazul.com/hc/pt-br/articles/28354467637901-Relat%C3%B3rios-de-vendas-quais-s%C3%A3o-os-relat%C3%B3rios-para-an%C3%A1lise-de-vendas-e-or%C3%A7amentos) · [WizGestor: aprovação online](https://wizgestor.com/recursos/orcamentos)
- [Stripe: numeração sequencial](https://docs.stripe.com/changelog/2020-03-02/sequentially-number-invoices) · ZapSign: [documentação](https://docs.zapsign.com.br/), [API](https://blog.zapsign.com.br/zapsign-api/)
- Contexto Brasil: [WhatsApp em 98% dos celulares](https://santini.global/uso-whatsapp-brasileiros/), [IBGE PNAD TIC 2024](https://www.cnnbrasil.com.br/economia/celular-avanca-entre-idosos-e-na-area-rural-e-quase-90-da-populacao-do-pais-tem-aparelho/), [Pix no 1º semestre de 2025](https://g1.globo.com/economia/pix/noticia/2025/11/10/transacoes-via-pix-subiram-276percent-no-1o-semestre-de-2025-e-responderam-por-mais-da-metade-do-total-diz-bc.ghtml), [LGPD (Lei 13.709/2018)](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)

O conteúdo das fontes externas foi parafraseado para respeitar restrições de licenciamento.
