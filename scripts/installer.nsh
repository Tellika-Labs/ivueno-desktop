; Ivueno setup: same colours and wording as the app (colours from src/renderer/styles/tokens.css).
; electron-builder includes this file through build.nsis.include in package.json.

; set a setting even when electron-builder or NSIS already defined it (a second !define is a build error)
!macro ivSet NAME VALUE
  !ifdef ${NAME}
    !undef ${NAME}
  !endif
  !define ${NAME} "${VALUE}"
!macroend

!macro customHeader
  ; --bg and --text of the app: the welcome and finish pages and the header strip use them
  !insertmacro ivSet MUI_BGCOLOR "F7F5F2"
  !insertmacro ivSet MUI_TEXTCOLOR "1F1D1A"

  !insertmacro ivSet MUI_WELCOMEPAGE_TITLE "Bem-vindo à Ivueno"
  !insertmacro ivSet MUI_WELCOMEPAGE_TEXT "A Ivueno escreve as notas das tuas reuniões, sem bot na chamada.$\r$\n$\r$\nVamos instalá-la neste computador. Demora menos de um minuto e não precisas de transferir mais nada.$\r$\n$\r$\nCarrega em Seguinte para continuar."

  !insertmacro ivSet MUI_FINISHPAGE_TITLE "A Ivueno está pronta"
  !insertmacro ivSet MUI_FINISHPAGE_TEXT "Instalámos a Ivueno neste computador. Podes abri-la já e começar a tua primeira reunião.$\r$\n$\r$\nCarrega em Concluir para fechar."
  !insertmacro ivSet MUI_FINISHPAGE_RUN_TEXT "Abrir a Ivueno"
!macroend

; electron-builder skips the welcome page unless asked: this is the first screen, like the app's own first-run screen
!macro customWelcomePage
  !insertmacro MUI_PAGE_WELCOME
!macroend
