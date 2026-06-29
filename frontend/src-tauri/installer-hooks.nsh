; Custom NSIS hooks for Aphelion.
;
; The standard uninstaller removes the app + bundled engine, but NOT the user's
; downloaded models and chat data (kept in %APPDATA%\com.localllm.studio, which
; can be several GB). On uninstall, offer to remove those too.

!macro NSIS_HOOK_POSTUNINSTALL
  MessageBox MB_YESNO|MB_ICONQUESTION "Delete user data and downloaded models?$\n$\nThis permanently removes your downloaded models (can be several GB), characters, personas, and conversations from this computer.$\n$\nChoose No to keep them — for example, if you plan to reinstall." /SD IDNO IDNO lls_keep_data
    RMDir /r "$APPDATA\com.localllm.studio"
    RMDir /r "$LOCALAPPDATA\com.localllm.studio"
  lls_keep_data:
!macroend
