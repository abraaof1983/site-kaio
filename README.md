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

## Fluxo

1. Cadastre sua conta e revise os dados da empresa em **Configurações**.
2. Cadastre clientes e pacotes com equipamentos e preços.
3. Crie um orçamento com evento, horários, validade e parcelas.
4. Baixe o PDF ou converta o orçamento em contrato.
5. Revise as cláusulas, autorização de imagem e condições, e emita o PDF do contrato.

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
