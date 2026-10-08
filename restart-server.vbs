' ============================================================
'  Koyome.me - restart the local site server, in one double-click.
'
'  This is the whole cycle the owner used to do by hand:
'    Task Manager -> find node.exe -> end task -> run start-koyome.vbs
'
'  WHY THIS IS A SEPARATE FILE FROM start-koyome.vbs
'  start-koyome.vbs is also called by the Startup folder at logon.
'  A launcher that kills processes before starting would take down
'  anything it matched every time the machine booted. Restarting is a
'  deliberate act; starting is not. So the kill step lives only here.
'
'  THREE THINGS IT IS CAREFUL ABOUT
'
'  1. It only kills the node process running THIS site. There are
'     several node.exe processes on this machine (editor helpers and
'     others), so the match is on the command line - it must name both
'     "server.js" and "koyome" - never on the process name alone.
'     "koyome" rather than "koyome-site" because the server is
'     sometimes started from the repository path, which does not
'     contain "koyome-site"; matching only that would miss it and
'     start a second server that dies on EADDRINUSE while the old
'     one keeps serving stale code - the worst possible outcome.
'
'  2. It waits for the old process to actually die before starting
'     the new one, for the same EADDRINUSE reason.
'
'  3. It finds node the same self-healing way start-koyome.vbs does.
'     Hard-coding C:\Users\Public\koyome-node is exactly what broke
'     before: that is a symlink to one node build, and when the build
'     was replaced the link dangled and the server silently never
'     started.
'
'  Then it asks the server whether it is really answering, so a
'  silent failure is reported instead of assumed away.
'
'  Kept to ASCII on purpose: VBScript reads .vbs through the system
'  codepage, and Chinese text saved as UTF-8 comes out as mojibake
'  on some machines.
' ============================================================
Option Explicit

Const SITE = "C:\Users\Public\koyome-site"
Const SRV  = "C:\Users\Public\koyome-site\server.js"
Const PIN  = "C:\Users\Public\koyome-node\node.exe"

Dim fso, ws, VDIR
Set fso = CreateObject("Scripting.FileSystemObject")
Set ws  = CreateObject("WScript.Shell")
VDIR    = ws.ExpandEnvironmentStrings("%USERPROFILE%") & _
          "\.workbuddy\binaries\node\versions"

If Not fso.FileExists(SRV) Then
  MsgBox "server.js was not found at:" & vbCrLf & SRV & vbCrLf & vbCrLf & _
         "Nothing was started.", 16, "Koyome - restart site"
  WScript.Quit 1
End If

Dim node
node = FindNode()
If node = "" Then
  MsgBox "No node.exe was found, so the site was NOT started." & vbCrLf & vbCrLf & _
         "Looked in:" & vbCrLf & _
         "  1. " & PIN & vbCrLf & _
         "  2. " & VDIR & vbCrLf & _
         "  3. your PATH", 16, "Koyome - restart site"
  WScript.Quit 1
End If

' ---------- 1. stop the old one ----------
Dim killed, pids, p, cl, pid, listed
killed = 0
pids   = ""
listed = False

On Error Resume Next
Dim wmi, procs
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
If Err.Number = 0 Then
  Set procs = wmi.ExecQuery( _
    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
  If Err.Number = 0 Then
    listed = True
    For Each p In procs
      cl = LCase(CStr(p.CommandLine & ""))
      If InStr(cl, "server.js") > 0 And InStr(cl, "koyome") > 0 Then
        pid = p.ProcessId
        pids = pids & pid & " "
        killed = killed + 1
        ws.Run "taskkill /PID " & pid & " /F", 0, True
      End If
    Next
  End If
End If
Err.Clear
On Error GoTo 0

' ---------- 2. wait for it to be gone ----------
Dim tries
For tries = 1 To 16
  If CountServers() = 0 Then Exit For
  WScript.Sleep 250
Next

' ---------- 3. start the new one ----------
ws.CurrentDirectory = SITE
ws.Run """" & node & """ """ & SRV & """", 0, False

' ---------- 4. ask it whether it is really up ----------
Dim up, waited
up = False
For waited = 1 To 20
  WScript.Sleep 250
  If Alive() Then up = True : Exit For
Next

' ---------- 5. report ----------
Dim msg, icon
If Not listed Then
  ' The dangerous silent case: nothing was stopped, so the old process
  ' is still holding port 80 and still running the old server.js.
  ' Saying "restarted" here would be a lie.
  msg = "Started, but I could not list running processes," & vbCrLf & _
        "so nothing was stopped first." & vbCrLf & vbCrLf & _
        "The old server may still be holding port 80." & vbCrLf & _
        "Check Task Manager for node.exe." & vbCrLf
  icon = 48
ElseIf up Then
  msg = "Koyome site is running again." & vbCrLf & vbCrLf & _
        "http://Koyome.me" & vbCrLf
  If killed > 0 Then
    msg = msg & vbCrLf & "Stopped " & killed & " old process(es): " & Trim(pids)
  Else
    msg = msg & vbCrLf & "No old server was running - started fresh."
  End If
  icon = 64
Else
  msg = "The server was started but is not answering yet." & vbCrLf & vbCrLf & _
        "Wait a few seconds and reload http://Koyome.me" & vbCrLf
  If killed > 0 Then msg = msg & vbCrLf & "Stopped " & killed & " old process(es)."
  icon = 48
End If
MsgBox msg, icon, "Koyome - restart site"
WScript.Quit 0


' ---- find a usable node.exe, best source first ----------------
Function FindNode()
  FindNode = ""
  Dim sub_, best, bestT, tmp, ts, ln

  ' 1. the pinned copy beside the site - stable, version-independent
  If fso.FileExists(PIN) Then
    FindNode = PIN
    Exit Function
  End If

  ' 2. newest managed build under %USERPROFILE%\.workbuddy
  If fso.FolderExists(VDIR) Then
    best = ""
    For Each sub_ In fso.GetFolder(VDIR).SubFolders
      If fso.FileExists(sub_.Path & "\node.exe") Then
        If best = "" Or sub_.DateLastModified > bestT Then
          best = sub_.Path & "\node.exe"
          bestT = sub_.DateLastModified
        End If
      End If
    Next
    If best <> "" Then
      FindNode = best
      Exit Function
    End If
  End If

  ' 3. whatever "node" resolves to on PATH (kept hidden - no console)
  tmp = fso.GetSpecialFolder(2) & "\koyome_where_node.txt"
  ws.Run "cmd /c where node > """ & tmp & """ 2>nul", 0, True
  If fso.FileExists(tmp) Then
    Set ts = fso.OpenTextFile(tmp, 1)
    If Not ts.AtEndOfStream Then ln = Trim(ts.ReadLine())
    ts.Close
    fso.DeleteFile tmp, True
    If ln <> "" And fso.FileExists(ln) Then
      FindNode = ln
      Exit Function
    End If
  End If
End Function


' ---- how many koyome servers are alive ------------------------
Function CountServers()
  Dim n, w, ps, q, c
  n = 0
  On Error Resume Next
  Set w = GetObject("winmgmts:\\.\root\cimv2")
  If Err.Number = 0 Then
    Set ps = w.ExecQuery( _
      "SELECT CommandLine FROM Win32_Process WHERE Name = 'node.exe'")
    If Err.Number = 0 Then
      For Each q In ps
        c = LCase(CStr(q.CommandLine & ""))
        If InStr(c, "server.js") > 0 And InStr(c, "koyome") > 0 Then n = n + 1
      Next
    End If
  End If
  Err.Clear
  On Error GoTo 0
  CountServers = n
End Function


' ---- is the site actually answering? --------------------------
Function Alive()
  Alive = False
  On Error Resume Next
  Dim h
  Set h = CreateObject("WinHttp.WinHttpRequest.5.1")
  If Err.Number = 0 Then
    h.SetTimeouts 1200, 1200, 1200, 1200
    h.Open "GET", "http://127.0.0.1/api/visits", False
    h.Send
    If Err.Number = 0 Then
      If h.Status >= 200 And h.Status < 400 Then Alive = True
    End If
  End If
  Err.Clear
  On Error GoTo 0
End Function
