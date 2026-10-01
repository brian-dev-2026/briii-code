; Test harness for staged-update.iss: runs FinishStagedUpdateIn against a fake app folder and
; writes "ok" or "failed" to /result=<file>. Installs nothing. Built and run by swap.test.ps1.
[Setup]
AppName=Briii swap test
AppVersion=1
CreateAppDir=no
Uninstallable=no
PrivilegesRequired=lowest
OutputBaseFilename=swap-test
SetupLogging=yes

[Code]
#include "..\staged-update.iss"

function InitializeSetup: Boolean;
var
  Ok: Boolean;
  Text: String;
begin
  Ok := FinishStagedUpdateIn(ExpandConstant('{param:app}'), 'BriiiSwapTestMutex',
    SplitItems(ExpandConstant('{param:items}')),
    StrToInt(ExpandConstant('{param:killafter|30}')), StrToInt(ExpandConstant('{param:giveup|600}')));
  if Ok then Text := 'ok' else Text := 'failed';
  SaveStringToFile(ExpandConstant('{param:result}'), Text, False);
  Result := False; // nothing to install
end;
