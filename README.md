# AOF Studio · Gestão de eventos

Sistema web em português para clientes, pacotes e preços, orçamentos e contratos de serviços de DJ e eventos. Modelos adaptados dos contratos fornecidos pela empresa, sem importar dados pessoais ou assinaturas dos clientes.

## Instalar no Windows

O sistema roda no computador de quem usa. Não precisa instalar o Node.js e **não precisa ser administrador**.

1. Copie a pasta `AOF Studio` para o computador (ou descompacte o `AOF-Studio-<versão>-windows.zip`).
2. Dê duplo clique em **`Instalar.cmd`**.
3. Abra o **AOF Studio** pelo menu Iniciar ou pelo atalho da área de trabalho.

A instalação copia um único arquivo para `%LOCALAPPDATA%\Programs\AOF Studio` e cria os atalhos do seu usuário. Nada é escrito em `Program Files` nem no registro do Windows, e nenhum serviço fica em segundo plano.

Ao abrir, o programa sobe o sistema e o navegador vai para `http://localhost:3000`. A janela de console é o motor do sistema: deixe-a aberta durante o uso e feche-a para encerrar. Abrir o atalho de novo reaproveita a janela que já está aberta, em vez de subir uma segunda cópia.

O endereço responde **somente neste computador** (127.0.0.1). Outras máquinas da rede não alcançam o sistema nem o banco, e por isso o celular também não acessa.

Telas, imagens e as fontes dos PDFs ficam dentro do programa, então o sistema funciona sem Internet. A única exceção é a tipografia da interface, importada do Google Fonts: sem Internet ela cai para as fontes locais de reserva, sem afetar os PDFs.

### Comandos do programa

| Comando | O que faz |
|---|---|
| `--instalar` | Instala para o seu usuário e cria os atalhos. |
| `--desinstalar` | Remove os atalhos e a pasta do programa. Os dados continuam. |
| `--importar <pasta>` | Traz o `app.sqlite` de outra instalação ou da pasta `data/`. |
| `--pasta-dados` | Mostra onde ficam o banco e os backups. |
| `--ajuda` | Lista todos os comandos. |

Trazendo os dados de uma execução anterior pelo código-fonte:

```sh
"AOF Studio.exe" --importar "C:\caminho\do\projeto\data"
```

A cópia usa o backup do próprio SQLite, então inclui o que ainda estiver no diário WAL; copiar o `app.sqlite` à mão perderia esses registros. O banco atual é guardado como `.bak` antes da troca.

## Compilar o executável

Precisa do Node.js 24 e das dependências de desenvolvimento (`npm ci`).

```sh
npm run build:exe
npm run verify:exe
```

A saída fica em `dist/`: a pasta `AOF Studio` com o programa, o `Instalar.cmd` e o `LEIA-ME.txt`, mais o zip de entrega. O executável tem cerca de 97 MB porque leva dentro o runtime do Node, as fontes, as telas e as imagens — é isso que dispensa instalar o Node na máquina de destino.

`npm run verify:exe` exercita o executável compilado: comandos, banco na pasta do usuário, PDFs com as fontes embutidas, telas servidas de dentro do arquivo, escuta restrita a 127.0.0.1, instalação e desinstalação por usuário e importação de dados. Vale rodar sempre que mexer em leitura de arquivos, porque esse tipo de erro só aparece fora da pasta do projeto.

O ícone é versionado em `assets/aof-studio.ico`. Para regerá-lo a partir do logo: `node build/make-icon.mjs`.

## Executar a partir do código

Para desenvolver, ou para rodar sem compilar. Abrir `public/index.html` com duplo clique não inicia a aplicação: o sistema precisa do servidor. O GitHub guarda o código; GitHub Pages não executa o banco de dados e as APIs deste projeto.

1. Instale o **Node.js 24 LTS** em https://nodejs.org/ (o npm vem incluído).
2. Abra o terminal na pasta clonada, onde está o `package.json`. No Windows, abra essa pasta no Explorador de Arquivos, digite `cmd` na barra de endereço e pressione Enter.
3. Se o clone já existia antes da publicação, atualize-o com `git pull`.
4. Execute os comandos:

```sh
npm ci
npm start
```

5. Mantenha o terminal aberto e acesse **http://localhost:3000** no navegador. Crie sua conta por **Primeiro acesso? Criar uma conta**.

Se o terminal informar que `node` ou `npm` não foi encontrado, instale o Node.js e abra o terminal novamente. Confira a versão com `node --version`: utilize a versão 24 LTS. Se aparecer um erro no terminal, o servidor não iniciou; preserve a mensagem para diagnóstico.

Rodando pelo código, o banco fica em `data/`, na própria pasta do projeto, e o navegador não abre sozinho. A porta é escolhida entre 3000 e 3019; `PORT` fixa uma porta e `HOST` muda o endereço de escuta — use `HOST` apenas para publicar em servidor, junto com HTTPS, `COOKIE_SECURE=true` e disco persistente para `data/`.

Crie sua conta na tela inicial. Não há usuário ou senha padrão. Cada conta mantém seus próprios cadastros e documentos. O pacote inicial é editável.

### Sem instalar o Node.js

O Node.js também é distribuído em **ZIP portátil**, que funciona a partir de uma pasta do usuário sem instalação ou alterações no Windows.

1. Baixe o arquivo oficial [Node.js 24.22.0 para Windows x64 (ZIP)](https://nodejs.org/dist/v24.22.0/node-v24.22.0-win-x64.zip). Se o computador usa processador ARM, use o [ZIP ARM64](https://nodejs.org/dist/v24.22.0/node-v24.22.0-win-arm64.zip).
2. Na pasta do projeto, crie uma pasta chamada `runtime` e use **Extrair tudo** no ZIP. Preserve a pasta interna: deve existir `runtime/node-v24.22.0-win-x64/node.exe` (ou a variante ARM64). Extraia também todos os demais arquivos; não copie apenas o `node.exe`.
3. Dê duplo clique em **`iniciar-windows.cmd`**, na pasta do projeto. Ele usa essa versão portátil, instala as dependências no próprio projeto e inicia o servidor. Na primeira execução, precisa de Internet para baixar as dependências. Não execute como administrador.
4. O navegador abre sozinho em **http://localhost:3000** quando o sistema estiver pronto. Mantenha a janela aberta enquanto usa o sistema.

O iniciador limita o PATH à própria janela; não modifica configurações globais. O runtime, o cache e os cadastros não são enviados ao Git. As dependências são instaladas com `npm ci` só na primeira execução ou quando o `package-lock.json` muda; nas demais, o sistema abre sem Internet. Para forçar a reinstalação, apague a pasta `node_modules`. A instalação não apaga o banco em `data/`.

Os checksums oficiais são publicados em [SHASUMS256.txt](https://nodejs.org/dist/v24.22.0/SHASUMS256.txt). Para o ZIP x64 acima, o SHA-256 é `f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3`.

## Fluxo

1. Cadastre sua conta e revise os dados da empresa em **Configurações**.
2. Cadastre clientes e pacotes com equipamentos e preços.
3. Em **Novo orçamento**, escolha um modelo pronto ou comece em branco e preencha evento, horários, validade e parcelas. A validade sugerida é de 15 dias, ajustável em **Configurações**; depois dessa data, o orçamento aparece como **Vencido**.
4. Baixe o PDF ou gere o contrato. O contrato gerado abre para revisão, e o orçamento passa a aparecer como **Convertido**, com o atalho **Ver contrato**.
5. Revise as cláusulas, autorização de imagem e condições, e emita o PDF do contrato.

O PDF do contrato segue o modelo da AOF: moldura e cabeçalho com os logos em todas as páginas, ficha do evento em tabela, pacote e programação financeira, cláusulas numeradas, quadro de equipamentos por categoria, cidade e data, assinaturas e rodapé com o contato de **Configurações**. Para preencher recepção, cerimônia, celebrante, equipe do evento, segundo contato e indicação, abra **Ficha do evento no contrato** no formulário; o que ficar vazio sai em branco. Escreva os equipamentos um por linha, com a quantidade na frente (`04 Moving heads Beam 200`). Para separar as cláusulas, comece cada uma com o número e o título em maiúsculas (`1. OBJETO E SERVIÇOS`). Os logos ficam em `public/quote-assets/` (`logo-aof.jpg` e `logo-contrato.jpg`).

Cada tela tem endereço próprio (por exemplo, `#/orcamentos?situacao=enviados` ou `#/contratos/12`): o botão Voltar do navegador, o F5 e os links salvos abrem a mesma tela. Nas listas, as abas filtram por situação (com a contagem de cada uma), e é possível buscar por cliente, evento ou número e ordenar pela data do evento ou pelo valor. Clique em um documento para ver o resumo, o histórico e todas as ações. Cada linha mostra a ação mais provável (por exemplo, **Enviar** em rascunhos ou **Gerar contrato** em orçamentos enviados). As demais ações ficam no menu **⋯**: duplicar, arquivar e, para arquivados, restaurar ou excluir definitivamente. Arquivar oferece **Desfazer**; excluir pede confirmação.

**Enviar pelo WhatsApp** abre a conversa com o cliente e uma mensagem pronta, editável. O PDF vai como anexo: baixe-o pelo próprio aviso ou, em aparelhos compatíveis, use **Compartilhar PDF**. Ao enviar, o rascunho passa a **Enviado** e a data fica no histórico. No campo **Cliente**, busque pelo nome ou cadastre um cliente novo sem sair do orçamento. No celular, as listas aparecem em cartões e a navegação fica na barra inferior.

Excluir um cliente ou um pacote também pede confirmação e não altera documentos já emitidos, que guardam os dados da emissão.

Os formulários avisam antes de descartar alterações. O formulário de orçamento e contrato guarda um rascunho neste navegador: se a janela fechar sem salvar, o sistema oferece restaurar as alterações. Se a sessão expirar durante a edição, o sistema pede a senha de novo e conclui o salvamento.

A soma das parcelas, quando cadastradas, deve corresponder ao total. A conversão preserva o orçamento e evita contratos duplicados. Os dados comerciais da empresa e do cliente são registrados no documento: alterações posteriores no cadastro não alteram automaticamente documentos emitidos. Os documentos continuam editáveis para correções e revisão.

As cláusulas são uma adaptação editável e precisam de revisão jurídica antes do uso. A autorização de imagem começa desmarcada. O status “Assinado” é registrado manualmente: não há integração de assinatura eletrônica. Os PDFs têm campos para coleta das assinaturas.

## Persistência e operação

Banco SQLite com journal WAL, sempre no computador que roda o sistema. Instalado, fica em `%LOCALAPPDATA%\AOF Studio\data\app.sqlite`; rodando pelo código, em `data/app.sqlite` na pasta do projeto. `DATA_DIR` define outro diretório. O programa mostra o caminho ao iniciar e com `--pasta-dados`.

Preserve o diretório inteiro em backups consistentes com o SQLite: com o sistema fechado, copie a pasta toda, não só o arquivo principal. Dados e dependências não são versionados. Não use armazenamento efêmero em produção.

Senhas são derivadas com scrypt e salt individual; sessões com tokens aleatórios em cookies HttpOnly/SameSite expiram em 7 dias. Existe limitação de tentativas de login em memória. Para produção, configure HTTPS e `COOKIE_SECURE=true`, backups e controle do cadastro de contas conforme a política da empresa. Esta versão não inclui recuperação de senha, convite de equipe, cobrança online ou assinatura digital.

A fonte externa é opcional; a interface tem fontes locais de reserva.

## Verificar

```sh
npm test
npm audit --omit=dev
```

O teste de integração usa banco temporário e verifica cadastro/login, isolamento entre contas, parcelas, conversão idempotente de orçamento em contrato, preservação dos dados da emissão e geração de PDF. Não cria dados de demonstração no banco da aplicação.

Para conferir o executável compilado, `npm run verify:exe` (veja **Compilar o executável**). Ele usa pastas temporárias e remove os atalhos de teste ao terminar.

## Modelos de orçamento embarcados

O módulo **Orçamentos** inclui os modelos **Lagoa Vila Serena**, **Castelli Mondini** e **Gottesgabe Eventos**, com a identidade visual, logo e imagem ilustrativa dos exemplos enviados. Os modelos ficam disponíveis também para contas já existentes, sem recriar usuários ou substituir cadastros.

Em **Novo orçamento**, escolha o modelo (ou **Começar em branco**), selecione o cliente e preencha a data do novo evento. Nada vem pré-selecionado: o modelo também pode ser trocado depois, no campo **Modelo visual**. O local, os serviços, os equipamentos e os preços de referência são preenchidos e continuam editáveis antes da emissão. O modelo Castelli inclui opções de pacote completo, iluminação, somente DJ e cerimônia externa. Os exemplos não especificam equipamentos do kit de cerimônia ou da opção de iluminação: confirme a composição ao negociar.

Os valores à vista e parcelado são separados. A condição escolhida define o total do orçamento e do contrato resultante; as demais ofertas são alternativas, não valores somados. Somente o pacote completo tem referência de até 10 parcelas no cartão. A data de quitação de boleto é calculada para 10 dias antes do evento. O PDF diferencia proposta comercial de contrato e não inclui assinatura ou cláusulas contratuais no orçamento. O orçamento não mostra CPF/CNPJ nem endereço do cliente e traz as instruções para contratar com o WhatsApp e a chave Pix de **Configurações**. A situação interna (rascunho, enviado, aprovado) não aparece nos PDFs; o contrato só sinaliza rascunho e cancelamento.

Use **Visualizar PDF** para conferir e **Baixar PDF** para salvar. O PDF é gerado com imagens e fontes locais, sem depender de serviços externos. O modelo e os valores ficam registrados no documento; atualizar o catálogo não altera automaticamente propostas anteriores.

## Onde ficam minha conta e meus cadastros?

Os usuários, as senhas derivadas, os clientes e os documentos ficam **no seu computador**: em `%LOCALAPPDATA%\AOF Studio\data` quando instalado, ou em `data/` quando você roda pelo código. As senhas usam scrypt com salt individual e não ficam salvas como texto legível. Os dados não são enviados ao GitHub e não são compartilhados automaticamente com outro computador.

Para atualizar a versão instalada, feche o sistema e rode o `Instalar.cmd` da versão nova: ele substitui o programa e **não toca na pasta de dados**. Para fazer uma cópia de segurança, feche o sistema e copie a pasta de dados inteira para um local seguro; não copie apenas o arquivo principal com o sistema em execução. `--pasta-dados` mostra o caminho exato.
