' Stylish Game - hidden launcher.
' wscript.exe is a GUI subsystem host, so starting it creates NO console window.
' Usage:
'   silent.vbs --ensure   make sure the background keeper is running (scheduled task)
'   silent.vbs --loop     start the resident keeper directly
'   silent.vbs --open     ensure the service, then open the web page
Option Explicit
Dim sh, fso, base, nodeExe, arg, cmd, url
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
arg = "--ensure"
If WScript.Arguments.Count > 0 Then arg = WScript.Arguments(0)
nodeExe = "C:\Users\38339\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node.exe"
sh.CurrentDirectory = base
If arg = "--loop" Then
    cmd = """" & nodeExe & """ """ & base & "\keeper.js"" --loop"
    sh.Run cmd, 0, False
ElseIf arg = "--open" Then
    cmd = """" & nodeExe & """ """ & base & "\keeper.js"" --ensure"
    sh.Run cmd, 0, True
    url = "http://127.0.0.1:18888/"
    On Error Resume Next
    sh.Run url, 1, False
    If Err.Number <> 0 Then sh.Run "explorer.exe " & url, 1, False
    On Error GoTo 0
Else
    cmd = """" & nodeExe & """ """ & base & "\keeper.js"" --ensure"
    sh.Run cmd, 0, True
End If
WScript.Quit 0
