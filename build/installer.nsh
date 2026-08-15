!macro customInstall
  StrCpy $0 "$INSTDIR\resources\icon.ico"
  ${ifNot} ${FileExists} "$0"
    StrCpy $0 "$appExe"
  ${endIf}

  ${if} ${FileExists} "$newDesktopLink"
    Delete "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$0" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}

  ${if} ${FileExists} "$newStartMenuLink"
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$0" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}

  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
