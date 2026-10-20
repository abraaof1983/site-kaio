## Instalar no Windows

1. Baixe o `AOF-Studio-__VERSAO__-windows.zip` e descompacte a pasta.
2. Clique duas vezes em `Instalar.cmd`.
3. Abra o **AOF Studio** pelo menu Iniciar ou pelo atalho da área de trabalho.

Não precisa ser administrador e não precisa instalar o Node.js: o programa é um único arquivo, com o runtime, as telas e as fontes dentro dele.

Quem preferir o arquivo solto pode baixar o `AOF Studio.exe` e rodar `"AOF Studio.exe" --instalar`.

## Dados

Ficam em `%LOCALAPPDATA%\AOF Studio\data`, no seu computador. O sistema responde somente em `127.0.0.1`: nada na rede alcança o sistema nem o banco, e por isso o celular também não acessa.

Para trazer os dados de uma instalação anterior:

```
"AOF Studio.exe" --importar "C:\caminho\da\pasta\data"
```

Atualizar por cima não apaga os dados. Para fazer backup, feche o sistema e copie a pasta inteira. `"AOF Studio.exe" --pasta-dados` mostra o caminho exato.

## Observações

O executável não tem assinatura digital. Baixado pelo navegador, o Windows pode pedir confirmação na primeira execução.

A tipografia da interface vem do Google Fonts: sem Internet, ela cai para as fontes locais de reserva, sem afetar os PDFs.
