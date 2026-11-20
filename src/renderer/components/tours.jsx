/**
 * The tutorials, one per use case. `target` is a CSS selector for the element to light (a data-tour attribute on the screen);
 * a step whose element is not on screen is shown in the middle instead, so a tour never gets stuck.
 * Texts go straight through t() so the English test covers them like every other screen.
 */
export function buildTours(t) {
  return [
    {
      id: 'home', icon: 'home', title: t("Conhecer o início"), blurb: t("Onde começar, onde ficam as reuniões e como as encontrar."),
      steps: [
        { target: '[data-tour="new"]', placement: 'right', title: t("Começa aqui"), body: t("“Nova reunião” abre o arranque: dás um título, dizes onde estão as pessoas e começas a gravar. Também podes começar a partir de um evento do calendário.") },
        { target: '[data-tour="recents"]', placement: 'bottom', title: t("As tuas reuniões recentes"), body: t("Cada cartão mostra o dia, um resumo, as tarefas e o estado. Clica para abrir as notas. Desliza para o lado, ou usa as setas, para ver mais.") },
        { target: '[data-tour="next"]', placement: 'top', title: t("O que vem a seguir"), body: t("Se ligares o teu calendário, as reuniões das próximas 48 horas aparecem aqui, com “Tomar notas” a um clique.") },
        { target: '[data-tour="import"]', placement: 'bottom', title: t("Já tens uma gravação?"), body: t("Importa um áudio de até 4 horas, como uma chamada de WhatsApp, e recebe a transcrição, as notas e as tarefas.") },
        { target: '[data-tour="search"]', placement: 'bottom', title: t("Procura pelo título"), body: t("Escreve aqui para filtrar as reuniões. Para procurar dentro das notas e das transcrições, usa “Pesquisar” no menu.") },
        { target: '[data-tour="folders"]', placement: 'right', title: t("Organiza por pastas"), body: t("Junta as reuniões por cliente ou projeto. O + cria uma pasta nova.") },
        { target: '[data-tour="nav-tasks"]', placement: 'right', title: t("As tuas tarefas"), body: t("Todas as tarefas de todas as reuniões, num só sítio.") },
        { target: '[data-tour="side-toggle"]', placement: 'right', title: t("Mais espaço"), body: t("Esconde a barra lateral quando precisares de mais espaço, e mostra-a outra vez no mesmo botão.") },
      ],
    },
    {
      id: 'start', icon: 'mic', title: t("Começar uma reunião"), blurb: t("Como preparar a gravação e avisar as pessoas."),
      steps: [
        { target: '[data-tour="start-title"]', placement: 'bottom', title: t("Dá-lhe um nome"), body: t("É opcional. Se vieres do calendário, o título já vem preenchido. Podes mudá-lo a qualquer momento.") },
        { target: '[data-tour="start-notice"]', placement: 'top', title: t("Avisa quem está na reunião"), body: t("Antes de gravar, avisa os participantes. A tua resposta fica guardada no registo de consentimento da reunião.") },
        { target: '[data-tour="start-go"]', placement: 'top', title: t("Começar a gravar"), body: t("“Já avisei” começa com os participantes avisados. “Só eu” é para notas pessoais, sem mais ninguém na conversa.") },
      ],
    },
    {
      id: 'live', icon: 'speaker', title: t("Durante a reunião"), blurb: t("O que vês e o que podes fazer enquanto grava."),
      where: t("Aparece sozinho na tua próxima gravação."),
      steps: [
        { target: '[data-tour="live-head"]', placement: 'bottom', title: t("Estás a gravar"), body: t("Vês o tempo e os níveis do microfone e do som. Podes pausar quando quiseres. “Parar” termina a gravação.") },
        { target: '[data-tour="live-transcript"]', placement: 'right', title: t("Quem disse o quê"), body: t("A transcrição aparece ao vivo, com a cor e o nome de cada pessoa. “Pausar leitura” congela o ecrã sem parar a gravação.") },
        { target: '[data-tour="live-notes"]', placement: 'left', title: t("As tuas notas"), body: t("Escreve só o que importa. Usa os botões para listas e caixas de verificação. O que escreves nunca é substituído.") },
        { target: '[data-tour="live-speakers"]', placement: 'top', title: t("Dá nomes às pessoas"), body: t("Clica num orador para mudar o nome. As notas passam a usá-lo.") },
        { target: '[data-tour="live-helps"]', placement: 'top', title: t("Distraíste-te?"), body: t("As ajudas resumem o que se passou nos últimos minutos. Só tu vês as respostas.") },
        { target: '[data-tour="live-stop"]', placement: 'bottom', title: t("Quando acabar"), body: t("“Parar” termina a gravação e a Ivueno completa as tuas notas e as tarefas. Podes também controlar tudo pelo mini gravador, no topo do ecrã.") },
      ],
    },
    {
      id: 'detail', icon: 'edit', title: t("Depois da reunião"), blurb: t("Notas, transcrição, tarefas, perguntas e como enviar."),
      where: t("Precisas de pelo menos uma reunião guardada."),
      steps: [
        { target: '[data-tour="detail-head"]', placement: 'bottom', title: t("A tua reunião"), body: t("Mudas o título, a pasta e vês quem esteve. Fica guardada neste computador.") },
        { target: '[data-tour="detail-actions"]', placement: 'bottom', title: t("Enviar e guardar"), body: t("Escreve um email com as notas, partilha-as, ou exporta para Word, PDF ou Markdown.") },
        { target: '[data-tour="detail-tabs"]', placement: 'bottom', title: t("Quatro separadores"), body: t("Notas, Transcrição (com a hora de cada frase), Tarefas e Conversa, para fazeres perguntas à reunião.") },
        { target: '[data-tour="detail-ask"]', placement: 'bottom', title: t("Pede à Ivueno"), body: t("“Resumir”, decisões, perguntas sem resposta… A resposta vem só do que foi dito na reunião.") },
        { target: '[data-tour="detail-notes"]', placement: 'top', title: t("As tuas notas e as da Ivueno"), body: t("De um lado o que escreveste, do outro o que a Ivueno juntou, sempre marcado e com a hora em que foi dito.") },
      ],
    },
    {
      id: 'tasks', icon: 'tasks', title: t("Tarefas"), blurb: t("Ver, filtrar e concluir as tarefas das reuniões."),
      steps: [
        { target: '[data-tour="tasks-filter"]', placement: 'bottom', title: t("Filtra"), body: t("“Minhas” mostra as tuas e as que não têm dono. “Todas” mostra tudo e “Concluídas” é o histórico.") },
        { target: '[data-tour="tasks-list"]', placement: 'top', title: t("Marca o que já fizeste"), body: t("Marca a caixa quando acabares. O ícone do olho esconde uma tarefa que não interessa.") },
        { target: '[data-tour="tasks-link"]', placement: 'bottom', title: t("Volta à reunião"), body: t("Clica no título para abrir a reunião de onde a tarefa veio.") },
      ],
    },
    {
      id: 'import', icon: 'arrowDown', title: t("Importar uma gravação"), blurb: t("Transformar um áudio que já tens em notas e tarefas."),
      steps: [
        { target: '[data-tour="import-drop"]', placement: 'bottom', title: t("Escolhe o áudio"), body: t("Larga aqui um ficheiro (MP3, WAV, M4A, MP4, OGG, FLAC ou WEBM, até 4 horas). Serve para chamadas de WhatsApp e reuniões gravadas.") },
        { target: '[data-tour="import-voices"]', placement: 'top', title: t("Separar as vozes"), body: t("A Ivueno tenta distinguir quem falou (Orador 1, Orador 2…). Depois dás-lhes os nomes.") },
        { target: '[data-tour="import-rights"]', placement: 'top', title: t("Autorização"), body: t("Confirma que tens autorização para transcrever a gravação. As pessoas que falam sabem, ou deram permissão.") },
        { target: '[data-tour="import-go"]', placement: 'top', title: t("Importar"), body: t("O áudio é transcrito e apagado logo a seguir. A reunião fica guardada neste computador e gasta minutos de transcrição do teu plano.") },
      ],
    },
    {
      id: 'plans', icon: 'shieldCheck', title: t("Escolher um plano"), blurb: t("Comparar os planos e passar para um plano pago."),
      steps: [
        { target: '[data-tour="plans-kind"]', placement: 'bottom', title: t("Pessoal ou empresa"), body: t("Muda entre os planos para uma pessoa e os planos para equipas e empresas.") },
        { target: '[data-tour="plans-grid"]', placement: 'top', title: t("Compara os planos"), body: t("Cada cartão mostra o preço por mês em Kwanza, com IVA incluído, as reuniões e o que está incluído. O teu plano atual vem marcado.") },
        { target: '[data-tour="plans-upgrade"]', placement: 'top', title: t("Passar para um plano pago"), body: t("Escolhe um plano para abrir a página de pagamento. Ainda não pagas nada: só confirmas no fim.") },
        { target: '[data-tour="plans-note"]', placement: 'top', title: t("Sem renovação automática"), body: t("Não há cobrança automática. Avisamos-te antes de o plano terminar e renovas quando quiseres.") },
      ],
    },
    {
      id: 'checkout', icon: 'lock', title: t("Pagar o plano"), blurb: t("Escolher como pagar e confirmar o pagamento."),
      where: t("Aparece quando escolheres um plano para pagar."),
      steps: [
        { target: '.co-side', placement: 'left', title: t("O resumo"), body: t("Vês o plano, o valor e o IVA incluído antes de pagares.") },
        { target: '.co-methods', placement: 'bottom', title: t("Como queres pagar?"), body: t("Escolhe um dos métodos disponíveis. Multicaixa Express: recebes um pedido na app e confirmas com o PIN. Referência Multicaixa: pagas num ATM ou no banco online. WiPay: pagas na página segura da WiPay.") },
        { target: '.co-sep', placement: 'top', title: t("Preenche o que o método pede"), body: t("No Multicaixa Express escreves o número de telemóvel da app. Na referência e na WiPay não há mais nada a preencher.") },
        { target: '.co-full', placement: 'top', title: t("Só pagas quando confirmares"), body: t("Carregar aqui não te cobra nada. Só pagas quando confirmares no Multicaixa Express, na página da WiPay, ou no ATM com a referência.") },
        { target: null, title: t("Depois de pagar"), body: t("Com o Multicaixa Express e a WiPay o plano ativa em segundos. Com a referência, ativa quando o pagamento chegar, até 24 horas. Recebes o recibo por email.") },
      ],
    },
    {
      id: 'calendar', icon: 'laptop', title: t("Ligar o calendário"), blurb: t("Ver as próximas reuniões e começar com um clique."),
      steps: [
        { target: '#cal', placement: 'bottom', title: t("Liga o teu calendário"), body: t("Entra com a tua conta Google e aprova o acesso só de leitura. A Ivueno lê títulos, horas e participantes, e mais nada.") },
        { target: '#cal details', placement: 'top', title: t("Outro calendário?"), body: t("Com Outlook ou outro serviço, cola o endereço secreto (.ics) do calendário. Fica guardado encriptado neste computador.") },
      ],
    },
  ];
}
