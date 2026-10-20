# AOF Studio · Gestão de eventos

Sistema web em português para clientes, pacotes e preços, orçamentos e contratos de serviços de DJ e eventos. Modelos adaptados dos contratos fornecidos pela empresa, sem importar dados pessoais ou assinaturas dos clientes.

## Executar

O sistema precisa de um servidor Node.js: **abrir `public/index.html` com duplo clique não inicia a aplicação**. O GitHub guarda o código; GitHub Pages não executa o banco de dados e as APIs deste projeto.

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

Para publicar para outras pessoas, utilize uma hospedagem que execute **Node.js 24** com comando de instalação `npm ci`, comando de início `npm start` e disco persistente para `data/`. Somente enviar os arquivos ao GitHub ou publicar no GitHub Pages não inicia o sistema.

O servidor utiliza a porta 3000, configurável por `PORT`. Crie sua conta na tela inicial. Não há usuário ou senha padrão. Cada conta mantém seus próprios cadastros e documentos. O pacote inicial é editável.

## Sem administrador no Windows

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
3. Crie um orçamento com evento, horários, validade e parcelas. A validade sugerida é de 15 dias, ajustável em **Configurações**; depois dessa data, o orçamento aparece como **Vencido**.
4. Baixe o PDF ou gere o contrato. O contrato gerado abre para revisão, e o orçamento passa a aparecer como **Convertido**, com o atalho **Ver contrato**.
5. Revise as cláusulas, autorização de imagem e condições, e emita o PDF do contrato.

Os formulários avisam antes de descartar alterações. O formulário de orçamento e contrato guarda um rascunho neste navegador: se a janela fechar sem salvar, o sistema oferece restaurar as alterações. Se a sessão expirar durante a edição, o sistema pede a senha de novo e conclui o salvamento.

A soma das parcelas, quando cadastradas, deve corresponder ao total. A conversão preserva o orçamento e evita contratos duplicados. Os dados comerciais da empresa e do cliente são registrados no documento: alterações posteriores no cadastro não alteram automaticamente documentos emitidos. Os documentos continuam editáveis para correções e revisão.

As cláusulas são uma adaptação editável e precisam de revisão jurídica antes do uso. A autorização de imagem começa desmarcada. O status “Assinado” é registrado manualmente: não há integração de assinatura eletrônica. Os PDFs têm campos para coleta das assinaturas.

## Persistência e operação

Banco SQLite em `data/app.sqlite`, com journal WAL. `DATA_DIR` permite definir outro diretório persistente. Preserve o diretório inteiro em backups consistentes com o SQLite. Dados e dependências não são versionados. Não use armazenamento efêmero em produção.

Senhas são derivadas com scrypt e salt individual; sessões com tokens aleatórios em cookies HttpOnly/SameSite expiram em 7 dias. Existe limitação de tentativas de login em memória. Para produção, configure HTTPS e `COOKIE_SECURE=true`, backups e controle do cadastro de contas conforme a política da empresa. Esta versão não inclui recuperação de senha, convite de equipe, cobrança online ou assinatura digital.

A fonte externa é opcional; a interface tem fontes locais de reserva.

## Verificar

```sh
npm test
npm audit --omit=dev
```

O teste de integração usa banco temporário e verifica cadastro/login, isolamento entre contas, parcelas, conversão idempotente de orçamento em contrato, preservação dos dados da emissão e geração de PDF. Não cria dados de demonstração no banco da aplicação.

## Modelos de orçamento embarcados

O módulo **Orçamentos** inclui os modelos **Lagoa Vila Serena**, **Castelli Mondini** e **Gottesgabe Eventos**, com a identidade visual, logo e imagem ilustrativa dos exemplos enviados. Os modelos ficam disponíveis também para contas já existentes, sem recriar usuários ou substituir cadastros.

Clique em **Usar modelo**, selecione o cliente e preencha a data do novo evento. O botão **Novo orçamento** começa sem modelo e sem cliente selecionado; para aplicar um modelo, use **Usar modelo** ou o campo **Modelo visual**. O local, os serviços, os equipamentos e os preços de referência são preenchidos e continuam editáveis antes da emissão. O modelo Castelli inclui opções de pacote completo, iluminação, somente DJ e cerimônia externa. Os exemplos não especificam equipamentos do kit de cerimônia ou da opção de iluminação: confirme a composição ao negociar.

Os valores à vista e parcelado são separados. A condição escolhida define o total do orçamento e do contrato resultante; as demais ofertas são alternativas, não valores somados. Somente o pacote completo tem referência de até 10 parcelas no cartão. A data de quitação de boleto é calculada para 10 dias antes do evento. O PDF diferencia proposta comercial de contrato e não inclui assinatura ou cláusulas contratuais no orçamento. O orçamento não mostra CPF/CNPJ nem endereço do cliente e traz as instruções para contratar com o WhatsApp e a chave Pix de **Configurações**. A situação interna (rascunho, enviado, aprovado) não aparece nos PDFs; o contrato só sinaliza rascunho e cancelamento.

Use **Visualizar PDF** para conferir e **Baixar PDF** para salvar. O PDF é gerado com imagens e fontes locais, sem depender de serviços externos. O modelo e os valores ficam registrados no documento; atualizar o catálogo não altera automaticamente propostas anteriores.

## Onde ficam minha conta e meus cadastros?

Na execução local, os usuários, as senhas derivadas, os clientes e os documentos ficam **no seu computador**, no banco `data/app.sqlite`. As senhas usam scrypt com salt individual e não ficam salvas como texto legível. Os dados não são enviados ao GitHub e não são compartilhados automaticamente com outro computador.

Para atualizar o sistema, encerre o servidor, atualize o código e execute o iniciador novamente. **Preserve a pasta `data/`**. Para fazer uma cópia de segurança simples, feche o servidor e copie a pasta `data/` inteira para um local seguro; não copie apenas o arquivo principal enquanto o servidor estiver em execução.
