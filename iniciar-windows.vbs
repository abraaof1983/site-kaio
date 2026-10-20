Option Explicit
Dim shell, files, root, local, logs, command, result, environment
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(WScript.ScriptFullName)
local = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
logs = files.BuildPath(files.BuildPath(local, "AOF Studio"), "logs")
CreateFolders logs
Set environment = shell.Environment("PROCESS")
environment("AOF_DESKTOP") = "1"
environment("AOF_OPEN_BROWSER") = "1"
environment("AOF_DESKTOP_DIALOG") = "0"
environment("AOF_SOURCE_ROOT") = root
environment("AOF_SOURCE_LOG") = files.BuildPath(logs, "portable-startup.log")
shell.CurrentDirectory = root
' CMD prepares dependencies when necessary. Its window stays hidden; the Node
' server owns the dedicated application window and exits after that window closes.
command = shell.ExpandEnvironmentStrings("%COMSPEC%") & " /d /s /c " & Chr(34) & Chr(34) & "%AOF_SOURCE_ROOT%\iniciar-windows.cmd" & Chr(34) & " > " & Chr(34) & "%AOF_SOURCE_LOG%" & Chr(34) & " 2>&1" & Chr(34)
On Error Resume Next
result = shell.Run(command, 0, True)
If Err.Number <> 0 Then
  MsgBox "Nao foi possivel iniciar o AOF Studio. " & Err.Description, vbCritical, "AOF Studio"
ElseIf result <> 0 Then
  MsgBox "O sistema nao conseguiu abrir. Confira o Node portatil na pasta runtime e copie o erro do arquivo:" & vbCrLf & environment("AOF_SOURCE_LOG"), vbCritical, "AOF Studio"
End If
On Error GoTo 0

Sub CreateFolders(path)
  Dim parent
  If files.FolderExists(path) Then Exit Sub
  parent = files.GetParentFolderName(path)
  If parent <> "" And Not files.FolderExists(parent) Then CreateFolders parent
  files.CreateFolder(path)
End Sub
