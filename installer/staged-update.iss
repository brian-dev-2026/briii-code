// Staged updates, included in setup.iss's [Code] (and in test/swap-test.iss).
// briii-update runs setup with /update=1. The long copy then goes to <app>\_ while the installed
// app stays whole, so reopening Briii Code during an update simply starts the old version. Once
// no instance runs (its mutex is gone), the top-level items are swapped in by renames, which take
// milliseconds; a failed rename puts everything back.

// 'a|b|c' -> ['a', 'b', 'c'].
function SplitItems(S: String): TArrayOfString;
var
  P, N: Integer;
begin
  S := S + '|';
  N := 0;
  SetArrayLength(Result, 0);
  repeat
    P := Pos('|', S);
    if P > 1 then begin
      SetArrayLength(Result, N + 1);
      Result[N] := Copy(S, 1, P - 1);
      N := N + 1;
    end;
    Delete(S, 1, P);
  until S = '';
end;

// Moves the staged items into App; returns False (and restores the old files) on any failure.
function SwapStagedIn(App: String; Items: TArrayOfString): Boolean;
var
  Staged, Old: String;
  I, Done: Integer;
begin
  Result := True;
  Staged := App + '\_';
  Old := App + '\_old';
  ForceDirectories(Old);
  Done := 0;
  for I := 0 to GetArrayLength(Items) - 1 do begin
    if FileExists(App + '\' + Items[I]) or DirExists(App + '\' + Items[I]) then
      if not RenameFile(App + '\' + Items[I], Old + '\' + Items[I]) then begin
        Result := False;
        break;
      end;
    if not RenameFile(Staged + '\' + Items[I], App + '\' + Items[I]) then begin
      RenameFile(Old + '\' + Items[I], App + '\' + Items[I]);
      Result := False;
      break;
    end;
    Done := I + 1;
  end;
  if not Result then begin
    Log('Staged update: swap failed at ' + Items[Done] + ', restoring');
    for I := Done - 1 downto 0 do begin
      RenameFile(App + '\' + Items[I], Staged + '\' + Items[I]);
      RenameFile(Old + '\' + Items[I], App + '\' + Items[I]);
    end;
  end;
  DelTree(Old, True, True, True);
  if Result then DelTree(Staged, True, True, True);
end;

// Stops every process still running from App (only called once the app's mutex is gone: what is
// left are terminal hosts, language servers and the like that outlived the app).
procedure CloseLeftovers(App: String);
var
  Code: Integer;
  Quoted: String;
begin
  Quoted := App;
  StringChangeEx(Quoted, '''', '''''', True); // a quote inside a PowerShell '...' string is doubled
  // {sysnative}: setup is 32-bit, and a 32-bit PowerShell can't read 64-bit processes' paths.
  Exec(ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith(''' +
    Quoted + '\'', [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('Staged update: closed programs left running from ' + App + ' (exit ' + IntToStr(Code) + ')');
end;

const
  WorkbenchHtml = 'resources\app\out\vs\code\electron-browser\workbench\workbench.html';

// The background extension (shalldie.background) applies its images by adding a block to the
// installed workbench.html, between <!-- vscode-background-start ... --> and
// <!-- vscode-background-end -->, and by adding 'unsafe-inline' to script-src so that block's
// script may run. A new version's files have neither, so both are carried over (any copy of
// the block already there is replaced). PowerShell does the text work: it reads and writes the
// file as UTF-8, which Inno's Ansi file functions can't promise for image paths.
procedure CarryBackground(FromHtml, ToHtml: String);
var
  Text: AnsiString;
  Code: Integer;
  F, T: String;
begin
  if not FileExists(FromHtml) or not FileExists(ToHtml) then exit;
  if not LoadStringFromFile(FromHtml, Text) then exit;
  if Pos('<!-- vscode-background-start', Text) = 0 then exit;
  F := FromHtml;
  T := ToHtml;
  StringChangeEx(F, '''', '''''', True); // a quote inside a PowerShell '...' string is doubled
  StringChangeEx(T, '''', '''''', True);
  Exec(ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "' +
    '$u = New-Object Text.UTF8Encoding $false; ' +
    '$r = ''(?s)<!-- vscode-background-start.*?<!-- vscode-background-end -->''; ' +
    '$m = [regex]::Match([IO.File]::ReadAllText(''' + F + ''', $u), $r); ' +
    'if (-not $m.Success) { exit 1 }; ' +
    '$t = [regex]::Replace([IO.File]::ReadAllText(''' + T + ''', $u), ''(?s)'' + $r + ''\r?\n?'', ''''); ' +
    '$i = $t.LastIndexOf(''</html>''); if ($i -lt 0) { $i = $t.Length }; ' +
    '$t = $t.Insert($i, $m.Value + [char]10); ' +
    // Its <script> only runs with 'unsafe-inline' after script-src, which it adds the same way.
    'if ($t -notmatch ''script-src ''''unsafe-inline'''''') { ' +
    '$t = (New-Object regex ''(script-src)(\s)'').Replace($t, ''$1 ''''unsafe-inline''''$2'', 1) }; ' +
    '[IO.File]::WriteAllText(''' + T + ''', $t, $u)"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('Carried the background from ' + FromHtml + ' to ' + ToHtml + ' (exit ' + IntToStr(Code) + ')');
end;

// Waits (silently, up to a day) while someone uses the old version, then swaps. When the app has
// just closed, its terminals and servers may still hold files for a moment, so a failed swap is
// retried every 2 s; after KillAfterSec what still runs from the app folder is closed, and after
// GiveUpSec it gives up (the old version stays whole).
function FinishStagedUpdateIn(App, Mutex: String; Items: TArrayOfString; KillAfterSec, GiveUpSec: Integer): Boolean;
var
  Waited, Tried: Integer;
  Closed: Boolean;
begin
  Result := False;
  Tried := 0;
  Closed := False;
  repeat
    Waited := 0;
    while CheckForMutexes(Mutex) and (Waited < 24 * 60 * 60) do begin
      Sleep(1000);
      Waited := Waited + 1;
    end;
    if CheckForMutexes(Mutex) then exit;
    // Now, not earlier: the background may have been applied while the old version was open.
    if Tried = 0 then CarryBackground(App + '\' + WorkbenchHtml, App + '\_\' + WorkbenchHtml);
    if SwapStagedIn(App, Items) then begin
      Result := True;
      exit;
    end;
    if (not Closed) and (Tried >= KillAfterSec) and not CheckForMutexes(Mutex) then begin
      CloseLeftovers(App);
      Closed := True;
    end;
    Sleep(2000);
    Tried := Tried + 2;
  until Tried > GiveUpSec;
  Log('Staged update: giving up after ' + IntToStr(Tried) + ' s');
end;
