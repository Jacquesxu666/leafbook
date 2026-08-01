; installer.nsh — include via electron-builder’s nsis.include

;======================================================================
; customInstall macro is invoked by electron-builder after files are in $INSTDIR
!macro customInstall
  ; Ask the user if they want to register file associations
  MessageBox MB_YESNO|MB_ICONQUESTION \
  "Do you want to associate Markdown files (.md, .markdown, .mmd, .mdown, .mdtxt, .mdtext, .mdx) with LeafBook?" /SD IDNO IDNO SkipAssoc

  ;— User clicked YES, perform the registry writes —
  WriteRegStr HKCU "Software\Classes\.md"       "" "LeafBook.Document"
  WriteRegStr HKCU "Software\Classes\.markdown" "" "LeafBook.Document"
  WriteRegStr HKCU "Software\Classes\.mmd"      "" "LeafBook.Document"
  WriteRegStr HKCU "Software\Classes\.mdown"    "" "LeafBook.Document"
  WriteRegStr HKCU "Software\Classes\.mdtxt"    "" "LeafBook.Document"
  WriteRegStr HKCU "Software\Classes\.mdtext"   "" "LeafBook.Document"
  WriteRegStr HKCU "Software\Classes\.mdx"      "" "LeafBook.Document"

  WriteRegStr HKCU "Software\Classes\LeafBook.Document" \
    "" "LeafBook Markdown Document"
  WriteRegExpandStr HKCU "Software\Classes\LeafBook.Document\DefaultIcon" \
    "" "$INSTDIR\resources\icons\md.ico,0"
  WriteRegExpandStr HKCU "Software\Classes\LeafBook.Document\shell\open\command" \
    "" '"$INSTDIR\leafbook.exe" "%1"'
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

SkipAssoc:
!macroend

; Delete an extension key only while LeafBook still owns its default ProgID.
!macro LeafBookUnassociateExtension EXTENSION
  ReadRegStr $0 HKCU "Software\Classes\${EXTENSION}" ""
  StrCmp $0 "LeafBook.Document" 0 +3
  DeleteRegValue HKCU "Software\Classes\${EXTENSION}" ""
  DeleteRegKey /ifempty HKCU "Software\Classes\${EXTENSION}"
!macroend

;======================================================================
; customUnInstall macro cleans up on uninstall
!macro customUnInstall
  ; Preserve associations that another application claimed after installation.
  !insertmacro LeafBookUnassociateExtension ".md"
  !insertmacro LeafBookUnassociateExtension ".markdown"
  !insertmacro LeafBookUnassociateExtension ".mmd"
  !insertmacro LeafBookUnassociateExtension ".mdown"
  !insertmacro LeafBookUnassociateExtension ".mdtxt"
  !insertmacro LeafBookUnassociateExtension ".mdtext"
  !insertmacro LeafBookUnassociateExtension ".mdx"

  ; Only remove the ProgID when its open command still belongs to this install.
  ; This protects a newer/repaired LeafBook install which reclaimed the ProgID.
  ReadRegStr $0 HKCU "Software\Classes\LeafBook.Document\shell\open\command" ""
  StrCmp $0 '"$INSTDIR\leafbook.exe" "%1"' 0 KeepProgId
  DeleteRegKey HKCU "Software\Classes\LeafBook.Document"
KeepProgId:
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

  MessageBox MB_YESNO "Do you want to delete user settings?" /SD IDNO IDNO SkipRemoval
    SetShellVarContext current
    RMDir /r "$APPDATA\leafbook"
  SkipRemoval:
!macroend
