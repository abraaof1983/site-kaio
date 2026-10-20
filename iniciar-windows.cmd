@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
if errorlevel 1 goto pasta_invalida

rem Usa somente o runtime descompactado pelo usuario nesta pasta.
rem Nao altera o PATH do Windows nem instala programas no sistema.
set "AOF_NODE_DIR="
if exist "%~dp0runtime\node.exe" set "AOF_NODE_DIR=%~dp0runtime"
if defined AOF_NODE_DIR goto runtime_encontrado
set /a AOF_RUNTIME_COUNT=0 >nul
for /d %%D in ("%~dp0runtime\node-v24.*-win-*") do if exist "%%~fD\node.exe" set /a AOF_RUNTIME_COUNT+=1 >nul
if %AOF_RUNTIME_COUNT% GTR 1 goto runtime_ambiguo
for /d %%D in ("%~dp0runtime\node-v24.*-win-*") do if exist "%%~fD\node.exe" set "AOF_NODE_DIR=%%~fD"
if not defined AOF_NODE_DIR goto runtime_ausente

:runtime_encontrado
if not exist "%AOF_NODE_DIR%\npm.cmd" goto runtime_incompleto
set "PATH=%AOF_NODE_DIR%;%PATH%"
set "npm_config_cache=%~dp0.cache\npm"
"%AOF_NODE_DIR%\node.exe" -e "if(Number(process.versions.node.split('.')[0])!==24){console.error('Use o Node.js 24 LTS.');process.exit(1)}"
if errorlevel 1 goto falha

rem Instala as dependencias so na primeira vez ou quando o package-lock.json mudar.
rem Para forcar a reinstalacao, apague a pasta node_modules.
"%AOF_NODE_DIR%\node.exe" -e "const f=require('fs'),h=require('crypto').createHash('sha256').update(f.readFileSync('package-lock.json')).digest('hex');let s='';try{s=f.readFileSync('node_modules/.aof-lock-sha256','utf8').trim()}catch{}process.exit(s===h?0:1)"
if not errorlevel 1 goto dependencias_ok
echo Preparando as dependencias do AOF Studio. Isso precisa de Internet e acontece so na primeira vez ou depois de atualizacoes.
call "%AOF_NODE_DIR%\npm.cmd" ci --no-audit --no-fund
if errorlevel 1 goto falha
"%AOF_NODE_DIR%\node.exe" -e "const f=require('fs');f.writeFileSync('node_modules/.aof-lock-sha256',require('crypto').createHash('sha256').update(f.readFileSync('package-lock.json')).digest('hex'))"

:dependencias_ok
echo.
if not defined PORT set "PORT=3000"
rem O servidor abre o navegador sozinho quando estiver pronto para responder.
set "AOF_OPEN_BROWSER=1"
echo O navegador abre em http://localhost:%PORT% quando o sistema estiver pronto.
echo Mantenha esta janela aberta enquanto usa o sistema.
echo.
call "%AOF_NODE_DIR%\npm.cmd" start
if errorlevel 1 goto falha
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
