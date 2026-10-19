@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto pasta_invalida

rem Usa somente o runtime descompactado pelo usuario nesta pasta.
rem Nao altera o PATH do Windows nem instala programas no sistema.
set "AOF_NODE_DIR="
set "AOF_MULTIPLE_RUNTIMES="
if exist "%~dp0runtime\node.exe" set "AOF_NODE_DIR=%~dp0runtime"
if defined AOF_NODE_DIR goto runtime_encontrado
for /d %%D in ("%~dp0runtime\node-v24.*-win-*") do call :selecionar_runtime "%%~fD"
if defined AOF_MULTIPLE_RUNTIMES goto runtime_ambiguo
if not defined AOF_NODE_DIR goto runtime_ausente

:runtime_encontrado
if not exist "%AOF_NODE_DIR%\npm.cmd" goto runtime_incompleto
set "PATH=%AOF_NODE_DIR%;%PATH%"
set "npm_config_cache=%~dp0.cache\npm"
"%AOF_NODE_DIR%\node.exe" -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Use o Node.js 24 LTS.');process.exit(1)}"
if errorlevel 1 goto falha

echo Preparando as dependencias do AOF Studio...
call "%AOF_NODE_DIR%\npm.cmd" ci --no-audit --no-fund
if errorlevel 1 goto falha

echo.
echo Acesse http://localhost:3000 no navegador depois da mensagem de inicializacao.
echo Mantenha esta janela aberta enquanto usa o sistema.
echo.
call "%AOF_NODE_DIR%\npm.cmd" start
if errorlevel 1 goto falha
exit /b 0

:selecionar_runtime
if not exist "%~1\node.exe" exit /b 0
if defined AOF_NODE_DIR set "AOF_MULTIPLE_RUNTIMES=1"
set "AOF_NODE_DIR=%~1"
exit /b 0

:runtime_ausente
echo.
echo Nao encontrei o Node.js portatil.
echo Baixe o ZIP oficial do Node.js 24 para Windows em https://nodejs.org/
echo Nao use o instalador MSI. Extraia o ZIP na pasta runtime deste projeto.
echo Exemplo: runtime\node-v24.22.0-win-x64\node.exe
echo Consulte a secao Sem administrador no Windows no README.md.
goto falha

:runtime_ambiguo
echo Encontrei mais de uma pasta Node na pasta runtime.
echo Mantenha apenas a versao Node.js 24 correspondente ao seu computador.
goto falha

:runtime_incompleto
echo A pasta do Node.js esta incompleta. Extraia todo o conteudo do ZIP, incluindo npm.cmd.
goto falha

:pasta_invalida
echo Nao foi possivel abrir a pasta do projeto. Extraia o projeto em uma pasta local sua.
goto falha

:falha
echo.
echo O sistema nao iniciou ou foi encerrado com erro. Copie a mensagem acima para diagnostico.
pause
exit /b 1
