## Abrir no Windows

1. Baixe o `AOF-Studio-__VERSAO__-windows.zip` e descompacte a pasta.
2. Abra **AOF Studio.exe** diretamente. Não é necessário instalar o Node.js nem ter acesso de administrador.
3. Para criar atalhos no menu Iniciar e na área de trabalho, use **Instalar.vbs**.

O aplicativo abre uma janela própria do Edge ou Chrome, **sem CMD visível**. O servidor roda apenas enquanto a janela está aberta e é encerrado quando ela é fechada, com uma breve tolerância para recarregamento. O navegador pessoal do usuário não é encerrado. É necessário ter Edge ou Chrome disponível no computador.

## Pacotes montados com produtos

- Pacotes são compostos por produtos do catálogo e suas quantidades, com pelo menos um item.
- **Cadastrar produto** permite criar e incluir um produto sem sair da montagem do pacote.
- Pacotes antigos em texto, inclusive o pacote padrão, são convertidos para produtos preservando quantidades, preço e descrição.
- A conversão reaproveita os produtos da conta, guarda o texto anterior e mantém os documentos já emitidos.

## Identidade visual

- Ícone AOF atualizado com o arquivo original fornecido.
- **Configurações → Logos dos PDFs** permite escolher logos separados para orçamento e contrato.
- Aceita PNG, JPG e ICO, com prévia, transparência e restauração do padrão.
- Cada conta guarda seus próprios logos; os documentos já emitidos preservam a identidade salva.

## Tipos de evento

- Menu com Casamento, Debutantes, Aniversário e Formatura.
- Imagem ilustrativa diferente para cada categoria, disponível sem internet nos orçamentos personalizados e nos modelos prontos.
- Prévia da imagem no formulário, com sugestões de título e apresentação que preservam textos personalizados.
- O tipo fica salvo e acompanha a conversão em contrato. Documentos antigos continuam com a apresentação anterior até a escolha de uma categoria.

## Correções

- Nova publicação dos pacotes montados com produtos. A tentativa `v1.2.1` não gerou uma release; esta versão inclui os diagnósticos de verificação Windows integrados pelo PR #14.
- Ações de editar, gerar PDF, converter e organizar documentos voltam a executar corretamente.
- Produtos mantêm os dados registrados no documento; modelos não herdam equipamentos de pacotes não selecionados.
- Duplicação não transfere autorização de imagem para outro cliente.
- Nomes completos de equipamentos e condições financeiras extensas são preservados no contrato.
- Importação valida o banco antes de substituir dados e guarda backup consistente.
- O servidor entrega somente arquivos públicos autorizados.

## Dados e atualização

O banco instalado continua em `%LOCALAPPDATA%\AOF Studio\data`. Feche o aplicativo antes de atualizar e preserve essa pasta. O sistema não publica o banco no GitHub nem sincroniza os dados com outro computador.

Para trazer dados de uma execução anterior pelo código-fonte, com o sistema fechado:

```sh
"AOF Studio.exe" --importar "C:\caminho\da\pasta\data"
```

A importação guarda uma cópia de segurança do banco atual e recusa uma origem incompatível. Para fazer backup manual, feche o sistema e copie a pasta de dados inteira.

A interface usa fontes locais de reserva sem Internet; os PDFs têm fontes e imagens incorporadas.
