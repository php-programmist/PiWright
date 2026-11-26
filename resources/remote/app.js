const ASK_PREFIX = "pi-wrapper:ask:";

const el = (id) => document.getElementById(id);
const stream = el("stream");
const dialogs = el("dialogs");
const tabs = el("tabs");
const dot = el("dot");
const projectLabel = el("project");
const modelLabel = el("model");
const contextLabel = el("context");
const input = el("input");
const sendButton = el("send");
const stopButton = el("stop");
const steerButton = el("steer");
const queueLabel = el("queue");
const attachButton = el("attach");
const fileInput = el("file");
const chips = el("chips");
const todoPanel = el("todo");
const hideToolsButton = el("hideTools");
const readModeButton = el("readMode");
const readExitButton = el("readExit");
const tgNotifyButton = el("tgNotify");
const menuButton = el("menuButton");
const mainMenu = el("mainMenu");
const menuNewSession = el("menuNewSession");
const menuKanban = el("menuKanban");
const kanbanMain = el("kanbanMain");
const footer = document.querySelector("footer");
const createOverlay = el("createOverlay");
const createForm = el("createForm");
const createName = el("createName");
const createProjectRow = el("createProjectRow");
const createProject = el("createProject");
const createModel = el("createModel");
const createThinkingRow = el("createThinkingRow");
const createThinking = el("createThinking");
const createCancel = el("createCancel");
const loopBar = el("loopBar");
const loopCheck = el("loopCheck");
const loopMaxInput = el("loopMax");
const loopInfoLabel = el("loopInfo");
const loopExitInput = el("loopExit");

// Page language: server serves index.html with <html lang> taken from PC settings (settings.language).
const LANG = document.documentElement.lang === "ru" ? "ru" : "en";
const RU = {
  "error": "ошибка",
  "extension error": "ошибка расширения",
  "context compaction…": "компакция контекста…",
  "compaction done": "компакция завершена",
  "Sessions": "Сессии",
  "PC link": "связь с ПК",
  "New session": "Новая сессия",
  "Name": "Имя",
  "Project": "Проект",
  "Model": "Модель",
  "Thinking": "Мышление",
  "Cancel": "Отмена",
  "Create": "Создать",
  "Loop": "Петля",
  "Loop iterations left": "Сколько итераций ещё осталось",
  "Loop exit condition (optional): the loop stops when the agent calls loop_stop; empty — until the iteration limit": "Условие выхода из петли (необязательно): петля остановится, когда агент вызовет loop_stop; пустое — до лимита итераций",
  "Message…": "Сообщение…",
  "Attach image": "Прикрепить картинку",
  "Telegram notifications on": "Уведомления в Telegram включены",
  "Telegram notifications off": "Уведомления в Telegram выключены",
  "Show tool blocks": "Показать блоки инструментов",
  "Hide tool blocks": "Скрыть блоки инструментов",
  "Exit read mode": "Выйти из режима чтения",
  "Read mode": "Режим чтения",
  "Stop": "Стоп",
  "Steer": "Подсказать",
  "Send": "Отправить",
  "Rename": "Переименовать",
  "Close": "Закрыть",
  "Rename tab": "Переименовать вкладку",
  "Save": "Сохранить",
  "Close tab?": "Закрыть вкладку?",
  "«{title}» will be unshared and disappear from the phone list. The tab will stay open on the PC.": "«{title}» снимется с remote и исчезнет из списка на телефоне. На ПК вкладка останется открытой.",
  "No remote sessions. Enable the toggle in the tab header in the IDE.": "Нет сессий на remote. Включи тоггл в шапке вкладки в IDE.",
  "{n}% context": "{n}% контекста",
  "[image]": "[картинка]",
  "Thinking…": "Размышления…",
  "Plan": "План",
  "Command": "Команда",
  "steer": "подсказка",
  "follow-up": "после хода",
  "Extension request": "Запрос расширения",
  "Method \"{method}\" can't be shown on the phone. Answer on the PC.": "Метод «{method}» телефон не умеет показывать. Ответь на ПК.",
  "pi asks": "pi спрашивает",
  "Timed out — pi used the default answer": "Время вышло — pi использовал ответ по умолчанию",
  "Yes": "Да",
  "No": "Нет",
  "OK": "OK",
  "Agent questions": "Вопросы агента",
  "{n} q.": "{n} вопр.",
  "Own answer": "Свой вариант",
  "Add note": "Добавить заметку",
  "Remove note": "Убрать заметку",
  "Note to answer…": "Заметка к ответу…",
  "Needs clarification": "Нужно пояснение",
  "Submit": "Отправить",
  "PC answered": "Ответил ПК",
  "Phone answered": "Ответил телефон",
  "Model does not accept images": "Модель не принимает картинки",
  "Model does not accept images — attachments removed": "Модель не принимает картинки — вложения сняты",
  "Max {n} images": "Максимум {n} картинки",
  "Image unreadable or too large": "Картинка не читается или слишком большая",
  "the turn had no tool calls": "ход без вызовов инструментов",
  "exit condition met": "условие выхода выполнено",
  "stopped by user": "остановлена пользователем",
  "iteration limit reached": "достигнут лимит итераций",
  "3 iterations in a row faster than 10 seconds": "3 итерации подряд быстрее 10 секунд",
  "failed to start the next iteration": "не удалось запустить следующую итерацию",
  "stopped: {reason}": "остановлена: {reason}",
  "active": "активна",
  "Default": "По умолчанию",
  "Copy": "Копировать",
  "Menu": "Меню",
  "Kanban": "Канбан",
  "No boards": "Нет досок",
  "Add task": "Добавить задачу",
  "Card title": "Название карточки",
  "Description": "Описание",
  "Edit": "Изменить",
  "Comments": "Комментарии",
  "Add comment": "Добавить комментарий",
  "Run in new session": "Выполнить в новой сессии",
  "Column menu": "Меню колонки",
  "Loop: while there are tasks": "Петля: пока есть задачи",
  "Loop: exact count": "Петля: точное количество",
  "Card not found": "Задача не найдена"
};

function t(key, vars) {
  let text = LANG === "ru" && RU[key] !== undefined ? RU[key] : key;
  if (vars) for (const name of Object.keys(vars)) text = text.replaceAll(`{${name}}`, String(vars[name]));
  return text;
}

/** Static index.html markup keeps no translations — applied via data-i18n* attributes. */
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((node) => { node.title = t(node.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-ph]").forEach((node) => { node.placeholder = t(node.dataset.i18nPh); });
  document.querySelectorAll("[data-i18n-aria]").forEach((node) => { node.setAttribute("aria-label", t(node.dataset.i18nAria)); });
}

const MAX_IMAGES = 3;
const MAX_IMAGE_SIDE = 1600;
const JPEG_QUALITIES = [0.8, 0.65, 0.5];
// Кадр WS — 2 MiB: три картинки по столько base64 ещё влезают.
const MAX_IMAGE_CHARS = 600000;

const EYE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
  '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
  '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>' +
  '<path d="M3 3l18 18"/></svg>';
const TG_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
  '<path d="M3 11.5 21 4l-4 16-5.5-6.2L9 16l.8-4.5z"/></svg>';
const TG_OFF_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
  '<path d="M3 11.5 21 4l-4 16-5.5-6.2L9 16l.8-4.5z"/><path d="M3 3l18 18"/></svg>';
const BOOK_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">' +
  '<path d="M12 6.6C10.4 5.1 8.2 4.6 4 4.6v13.9c4.2 0 6.4.5 8 2 1.6-1.5 3.8-2 8-2V4.6c-4.2 0-6.4.5-8 2z"/>' +
  '<path d="M12 6.6v13.9"/></svg>';

let ws = null;
let attached = null;
let attachedOnSocket = false;
let attachPending = false;
let streaming = false;
let modelSupportsImages = false;
let pendingImages = [];
let reconnectDelay = 500;
let requestSeq = 0;
const pendingRequests = new Map();
const openDialogs = new Map();
const toolCards = new Map();
let assistantBlock = null;
let liveContentSeen = false;
let todos = [];
let todoExpanded = false;
let toolsHidden = false;
let readMode = false;
let tgEnabled = false;
const hideToolsBySession = new Map();
// Невоспроизведённый промпт — свой у каждой сессии, иначе черновик перетекает между вкладками.
const draftBySession = new Map();
// Петля: включена ли настройкой на ПК, состояние — своё у каждой сессии (как hideTools).
let loopsEnabled = false;
let loopEnabled = false;
let loopInfo = null;
let loopMax = 20;
const loopEnabledBySession = new Map();
let lastSessions = [];
// Локальные вкладки канбана (не сессии): доски и карточки. Список — свой у страницы.
let localTabs = [];
let activeLocalTab = null;
/** Состояние открытой канбан-вкладки: доска, режим редактирования, свернутые колонки. */
let kanbanState = null;
/** Петли включены настройкой ПК: приходит в kanban_boards/attached. */
let kanbanLoopsEnabled = false;
// Модели из последнего catalog-кадра: уровни thinking берутся от выбранной модели, а не из общего списка.
let catalogModels = [];
// Общий список уровней из кадра — относится к текущей модели живой сессии; подстраховка для кэша
// настроек, где уровней на модель ещё нет (строки старых версий).
let catalogThinking = [];
const DEBUG = new URLSearchParams(location.search).has("debug");
const frameCounts = {};
let debugPanel = null;

function trackFrame(type) {
  frameCounts[type] = (frameCounts[type] || 0) + 1;
  if (!DEBUG) return;
  if (!debugPanel) {
    debugPanel = document.createElement("pre");
    debugPanel.style.cssText =
      "position:fixed;left:0;right:0;bottom:0;max-height:38vh;overflow:auto;margin:0;padding:6px 8px;" +
      "background:#000c;color:#8fd;font:11px/1.4 ui-monospace,monospace;z-index:99;white-space:pre-wrap";
    document.body.append(debugPanel);
  }
  const lines = Object.entries(frameCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${count}  ${key}`);
  debugPanel.textContent =
    `ws=${ws ? ws.readyState : "none"} attached=${attached ? attached.id : "-"} tools=${toolCards.size} nodes=${stream.children.length}\n` +
    lines.join("\n");
}

if (DEBUG) {
  window.addEventListener("error", (event) => {
    frameCounts["JS ERROR: " + (event.message || "?")] = (frameCounts["JS ERROR: " + (event.message || "?")] || 0) + 1;
  });
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    reconnectDelay = 500;
    attachedOnSocket = false;
    setDot();
    sendVisibility();
    if (attached) attach(attached.id);
    else send({ type: "sessions" });
  };
  ws.onmessage = (event) => {
    let frame;
    try {
      frame = JSON.parse(event.data);
    } catch {
      return;
    }
    handleFrame(frame);
  };
  ws.onclose = () => {
    ws = null;
    attachPending = false;
    setDot("off");
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
  ws.onerror = () => {};
}

function send(frame) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

/** Сервер гасит уведомления в Telegram, пока страница на переднем плане; atBottom — для unread-точек табов. */
function sendVisibility() {
  send({ type: "visibility", visible: document.visibilityState === "visible", atBottom: atBottom() });
}

document.addEventListener("visibilitychange", sendVisibility);

// Доскроллил до низа — сервер гасит unread-точку этой сессии.
let lastSentAtBottom = null;
stream.addEventListener("scroll", () => {
  const bottom = atBottom();
  if (bottom === lastSentAtBottom) return;
  lastSentAtBottom = bottom;
  sendVisibility();
});

function setDot(state) {
  dot.className = "dot";
  if (state === "off") dot.classList.add("off");
  else if (attached) dot.classList.add("idle");
}

function handleFrame(frame) {
  trackFrame(frame.type);
  switch (frame.type) {
    case "sessions": return onSessions(frame.sessions || []);
    case "attached": return onAttached(frame);
    case "snapshot": return onSnapshot(frame);
    case "error":
      attachPending = false;
      return addInfo(frame.message || t("error"), true);
    case "ui_answered": return onUiAnswered(frame);
    case "pong": return;
    case "response": return onResponse(frame);
    case "agent_start": setStreaming(true); return;
    case "agent_settled":
    case "agent_end": setStreaming(false); finishAssistant(); clearQueue(); return;
    case "message_start": return onMessageStart(frame);
    case "message_update": return onMessageUpdate(frame);
    case "message_end": return onMessageEnd(frame);
    case "tool_execution_start": return onToolStart(frame);
    case "tool_execution_update": return onToolUpdate(frame);
    case "tool_execution_end": return onToolEnd(frame);
    case "queue_update": return onQueue(frame);
    case "todos": return onTodos(frame);
    case "session_info_changed": return onSessionName(frame);
    case "extension_ui_request": return onUiRequest(frame);
    case "extension_error": return addInfo(frame.error || t("extension error"), true);
    case "compaction_start": return addInfo(t("context compaction…"));
    case "compaction_end": return addInfo(t("compaction done"));
    case "session_created": return onSessionCreated(frame);
    case "catalog": return onCatalog(frame);
    case "loop_state": return onLoopState(frame);
    case "kanban_boards":
    case "kanban_board": {
      const pending = frame.id != null ? pendingRequests.get(frame.id) : null;
      if (pending) {
        pendingRequests.delete(frame.id);
        pending(frame);
      }
      return;
    }
  }
}

/** Табы: сначала remote-сессии, потом локальные вкладки канбана. Клик — активация, долгое нажатие — меню. */
function renderTabs(sessions) {
  tabs.innerHTML = "";
  sessions.forEach((session) => {
    const tab = document.createElement("button");
    tab.className = "tab";
    tab.dataset.id = session.id;
    tab.title = session.project ? `${session.title} · ${session.project}` : session.title;
    const status = document.createElement("span");
    status.className = "dot " + (session.status === "idle" && !session.unread ? "" : session.status || "idle");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = session.title;
    tab.append(status, label);
    bindTabPress(tab, () => {
      if (attached && attached.id === session.id) return;
      attach(session.id);
    }, () => openTabMenu(session.id));
    tabs.append(tab);
  });
  localTabs.forEach((local) => {
    const tab = document.createElement("button");
    tab.className = "tab local";
    tab.dataset.id = local.id;
    tab.title = local.kind === "board" ? local.title : `${local.title} · ${local.project}`;
    const icon = document.createElement("span");
    icon.className = "tab-icon";
    icon.textContent = local.kind === "board" ? "▤" : "▦";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = local.title;
    tab.append(icon, label);
    bindTabPress(tab, () => activateLocalTab(local.id), () => openLocalTabMenu(local));
    tabs.append(tab);
  });
  markActiveTab();
}

function markActiveTab() {
  const id = activeLocalTab !== null ? activeLocalTab : attached ? attached.id : null;
  [...tabs.children].forEach((tab) => tab.classList.toggle("active", tab.dataset.id === id));
}

const LONG_PRESS_MS = 480;
const LONG_PRESS_SLOP = 12;

/** Клик по табу активирует его, долгое нажатие — меню. */
function bindTabPress(tab, onActivate, onLongPress) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let held = false;
  const cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };
  tab.addEventListener("pointerdown", (event) => {
    held = false;
    startX = event.clientX;
    startY = event.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      held = true;
      onLongPress();
    }, LONG_PRESS_MS);
  });
  tab.addEventListener("pointermove", (event) => {
    if (timer === null) return;
    if (Math.abs(event.clientX - startX) > LONG_PRESS_SLOP || Math.abs(event.clientY - startY) > LONG_PRESS_SLOP) cancel();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((type) => tab.addEventListener(type, cancel));
  tab.addEventListener("click", (event) => {
    if (held) {
      held = false;
      return;
    }
    onActivate();
  });
  // На десктопе долгое нажатие = правая кнопка: своё меню важнее браузерного.
  tab.addEventListener("contextmenu", (event) => event.preventDefault());
}

/** Меню вкладки: переименование и снятие с remote (вкладка на ПК остаётся открытой). */
function openTabMenu(sessionId) {
  const session = lastSessions.find((item) => item.id === sessionId);
  if (!session) return;
  const { body, close } = openModal(session.title);
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "menu-item";
  rename.textContent = t("Rename");
  rename.addEventListener("click", () => {
    close();
    openRenameDialog(session);
  });
  const closeTab = document.createElement("button");
  closeTab.type = "button";
  closeTab.className = "menu-item danger";
  closeTab.textContent = t("Close");
  closeTab.addEventListener("click", () => {
    close();
    confirmUnshare(session);
  });
  body.append(rename, closeTab);
}

function openRenameDialog(session) {
  const { body, close } = openModal(t("Rename tab"));
  const field = document.createElement("input");
  field.type = "text";
  field.maxLength = 100;
  field.value = session.title;
  const submit = () => {
    const name = field.value.trim();
    close();
    if (name) send({ type: "rename", id: session.id, name });
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  body.append(field, actionsRow(button(t("Cancel"), close, true), button(t("Save"), submit)));
  field.focus();
  field.select();
}

function confirmUnshare(session) {
  const { body, close } = openModal(t("Close tab?"));
  const text = document.createElement("p");
  text.textContent = t("«{title}» will be unshared and disappear from the phone list. The tab will stay open on the PC.", { title: session.title });
  const drop = button(t("Close"), () => {
    close();
    send({ type: "unshare", id: session.id });
  });
  drop.classList.add("danger");
  body.append(text, actionsRow(button(t("Cancel"), close, true), drop));
}

// ------------------------------------------------------------------- kanban tabs

/** Меню локальной вкладки (доска/карточка): только «Закрыть» — вкладка существует только на телефоне. */
function openLocalTabMenu(local) {
  const { body, close } = openModal(local.title);
  const closeTab = document.createElement("button");
  closeTab.type = "button";
  closeTab.className = "menu-item danger";
  closeTab.textContent = t("Close");
  closeTab.addEventListener("click", () => {
    close();
    closeLocalTab(local.id);
  });
  body.append(closeTab);
}

function closeLocalTab(id) {
  const tab = localTabs.find((item) => item.id === id);
  localTabs = localTabs.filter((item) => item.id !== id);
  if (tab && tab.kind === "board") {
    const prefix = "card:" + tab.project + "\u0000" + tab.boardId + "\u0000";
    localTabs = localTabs.filter((item) => !item.id.startsWith(prefix));
  }
  if (activeLocalTab !== null && !localTabs.some((item) => item.id === activeLocalTab)) {
    activeLocalTab = null;
    kanbanState = null;
    applyViewMode();
  }
  renderTabs(lastSessions);
}

function openBoardTab(project, boardId, name) {
  const id = "board:" + project + "\u0000" + boardId;
  let tab = localTabs.find((item) => item.id === id);
  if (!tab) {
    tab = { id, kind: "board", project, boardId, cardId: null, title: name };
    localTabs.push(tab);
    renderTabs(lastSessions);
  }
  activateLocalTab(id);
}

function openCardTab(project, boardId, card) {
  const id = "card:" + project + "\u0000" + boardId + "\u0000" + card.id;
  let tab = localTabs.find((item) => item.id === id);
  if (!tab) {
    tab = { id, kind: "card", project, boardId, cardId: card.id, title: card.title };
    localTabs.push(tab);
  }
  tab.title = card.title;
  renderTabs(lastSessions);
  activateLocalTab(id);
}

function activateLocalTab(id) {
  const tab = localTabs.find((item) => item.id === id);
  if (!tab) return;
  activeLocalTab = id;
  kanbanState = {
    kind: tab.kind,
    project: tab.project,
    boardId: tab.boardId,
    cardId: tab.cardId,
    board: null,
    error: null,
    collapsed: new Set(),
    editing: null
  };
  applyViewMode();
  renderKanbanView();
  requestKanbanBoard();
  markActiveTab();
}

/** Канбан-вкладка активна — лента/композер прячутся, вместо них дерево доски или карточка. */
function applyViewMode() {
  const local = activeLocalTab !== null;
  kanbanMain.hidden = !local;
  stream.hidden = local;
  footer.hidden = local;
  dialogs.hidden = local;
  if (local && kanbanState) {
    projectLabel.textContent = kanbanState.project;
    modelLabel.textContent = "";
    contextLabel.textContent = "";
    contextLabel.dataset.window = "";
  }
}

function requestKanbanBoard() {
  if (!kanbanState) return;
  request({ type: "kanban_board", project: kanbanState.project, boardId: kanbanState.boardId }, (frame) => {
    if (!kanbanState) return;
    if (frame.success && frame.board) {
      kanbanState.error = null;
      if (!kanbanState.board || frame.board.rev !== kanbanState.board.rev) {
        kanbanState.board = frame.board;
        syncLocalTabTitles();
        renderKanbanView();
      }
    } else if (frame.error && !kanbanState.board) {
      kanbanState.error = frame.error;
      renderKanbanView();
    }
  });
}

/** Заголовки вкладок-карточек следят за переименованием карточки (агент может править доску). */
function syncLocalTabTitles() {
  if (!kanbanState || !kanbanState.board) return;
  let changed = false;
  localTabs.forEach((tab) => {
    if (tab.kind !== "card" || tab.boardId !== kanbanState.boardId) return;
    const card = kanbanState.board.cards.find((item) => item.id === tab.cardId);
    if (card && card.title !== tab.title) {
      tab.title = card.title;
      changed = true;
    }
  });
  if (changed) renderTabs(lastSessions);
}

/** Ответ мутации/опроса: обновлённая доска перерисовывает дерево или карточку. */
function applyKanbanBoardResponse(frame) {
  if (!kanbanState) return;
  if (frame.success && frame.board) {
    kanbanState.error = null;
    kanbanState.board = frame.board;
    syncLocalTabTitles();
    renderKanbanView();
  } else if (frame.error) {
    kanbanState.error = frame.error;
    renderKanbanView();
  }
}

// Опрос доски раз в 3 с: агент пишет в файлы напрямую, пушей в remote-протоколе нет.
setInterval(() => {
  if (activeLocalTab === null || !kanbanState) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Пользователь печатает (комментарий/описание) — перерисовка отложится до следующего тика.
  if (kanbanMain.contains(document.activeElement)) return;
  requestKanbanBoard();
}, 3000);

/** Затемнённое окно поверх ленты: карточка с заголовком, телом и рядом кнопок. */
function openModal(title) {
  const overlay = document.createElement("div");
  overlay.className = "modal";
  const card = document.createElement("div");
  card.className = "modal-card";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const body = document.createElement("div");
  body.className = "modal-body";
  card.append(heading, body);
  overlay.append(card);
  document.body.append(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  return { card, body, close };
}

function actionsRow(...nodes) {
  const row = document.createElement("div");
  row.className = "actions";
  row.append(...nodes);
  return row;
}

function onSessions(sessions) {
  lastSessions = sessions;
  const previous = attached ? attached.id : null;
  renderTabs(sessions);
  if (sessions.length === 0) {
    attached = null;
    tgEnabled = false;
    applyTgNotify();
    stream.innerHTML = "";
    addInfo(t("No remote sessions. Enable the toggle in the tab header in the IDE."));
    updateAttachButton();
    setDot();
    return;
  }
  const current = sessions.find((session) => session.id === previous);
  if (current) {
    tgEnabled = current.telegram === true;
    applyTgNotify();
  }
  const stillThere = sessions.some((session) => session.id === previous);
  if ((!stillThere || !attachedOnSocket) && activeLocalTab === null) {
    attach(stillThere ? previous : sessions[0].id);
  }
}

function attach(id) {
  // onSessions и ws.onopen могут позвать attach дважды до ответа сервера —
  // второй attach повторно реплеит неотвеченный диалог и плодит дубли карточек.
  if (attachPending) return;
  attachPending = true;
  send({ type: "attach", id });
}

function onAttached(frame) {
  attached = frame;
  attachedOnSocket = true;
  attachPending = false;
  sendVisibility();
  // Открытие сессии возвращает из канбан-вкладки в ленту.
  if (activeLocalTab !== null) {
    activeLocalTab = null;
    kanbanState = null;
    applyViewMode();
  }
  setStreaming(false);
  assistantBlock = null;
  liveContentSeen = false;
  toolCards.clear();
  stream.innerHTML = "";
  dialogs.innerHTML = "";
  openDialogs.clear();
  markActiveTab();
  projectLabel.textContent = frame.project || "";
  pendingImages = [];
  renderChips();
  todos = [];
  todoExpanded = false;
  renderTodos();
  clearQueue();
  toolsHidden = hideToolsBySession.get(frame.id) === true;
  applyToolsHidden();
  tgEnabled = frame.telegram === true;
  applyTgNotify();
  loopsEnabled = frame.loops === true;
  kanbanLoopsEnabled = loopsEnabled;
  loopEnabled = loopEnabledBySession.get(frame.id) === true;
  loopInfo = null;
  applyLoopUi();
  input.value = draftBySession.get(frame.id) ?? "";
  autoGrow();
  updateAttachButton();
  setDot();
}

function onSnapshot(frame) {
  // Снимок приходит асинхронно: если живые события уже нарисовали ленту, история её не затирает.
  if (frame.messages && !liveContentSeen) renderHistory(frame.messages);
  if (frame.state) {
    const model = frame.state.model;
    if (model) {
      modelLabel.textContent = `${model.provider || ""}/${model.id || ""}`;
      if (typeof model.contextWindow === "number" && model.contextWindow > 0) {
        contextLabel.dataset.window = String(model.contextWindow);
      }
      modelSupportsImages = Array.isArray(model.input) && model.input.includes("image");
      updateAttachButton();
    }
  }
  if (frame.stats) {
    const usage = frame.stats.contextUsage;
    if (usage) updateContextUsage(usage.tokens, usage.contextWindow);
  }
  if (typeof frame.streaming === "boolean") setStreaming(frame.streaming);
}

/** Идёт ход — Send прячется, вместо него Steer (сообщение доставится до следующего шага модели). */
function setStreaming(value) {
  streaming = value;
  stopButton.hidden = !value;
  steerButton.hidden = !value;
  sendButton.hidden = value;
  setDot();
}

function onResponse(frame) {
  const pending = pendingRequests.get(frame.id);
  if (!pending) return;
  pendingRequests.delete(frame.id);
  if (!frame.success) addInfo(frame.error || `${frame.command} failed`, true);
  pending(frame);
}

function request(frame, onDone) {
  const id = `p${++requestSeq}`;
  pendingRequests.set(id, onDone || (() => {}));
  send({ ...frame, id });
}

function onMessageStart(frame) {
  const message = frame.message || {};
  if (message.role !== "assistant") return;
  startAssistant();
}

function startAssistant() {
  if (assistantBlock) return;
  liveContentSeen = true;
  const stick = stickBefore();
  const wrap = document.createElement("div");
  wrap.className = "msg assistant";
  const text = document.createElement("div");
  text.className = "text";
  wrap.append(text);
  stream.append(wrap);
  assistantBlock = { wrap, text, thinking: null };
  keepBottom(stick);
}

function thinkingBlock() {
  if (!assistantBlock) startAssistant();
  if (assistantBlock.thinking) return assistantBlock.thinking;
  const details = document.createElement("details");
  details.className = "thinking";
  const summary = document.createElement("summary");
  summary.textContent = t("Thinking…");
  const body = document.createElement("div");
  body.className = "body";
  details.append(summary, body);
  assistantBlock.wrap.insertBefore(details, assistantBlock.text);
  assistantBlock.thinking = body;
  return body;
}

function onMessageUpdate(frame) {
  const event = frame.assistantMessageEvent;
  if (!event || !event.delta) return;
  if (event.type === "text_delta") {
    startAssistant();
    const stick = stickBefore();
    assistantBlock.text.dataset.raw = (assistantBlock.text.dataset.raw || "") + event.delta;
    assistantBlock.text.innerHTML = markdown(assistantBlock.text.dataset.raw);
    keepBottom(stick);
  } else if (event.type === "thinking_delta") {
    const body = thinkingBlock();
    body.textContent += event.delta;
  }
}

function onMessageEnd(frame) {
  const message = frame.message || {};
  if (message.role === "user") {
    addUserMessage(message);
    scrollToBottom();
    return;
  }
  if (message.role !== "assistant") return;
  startAssistant();
  const stick = stickBefore();
  const text = (message.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const thinking = (message.content || [])
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking)
    .join("");
  if (thinking) thinkingBlock().textContent = thinking;
  assistantBlock.text.dataset.raw = text;
  assistantBlock.text.innerHTML = markdown(text);
  finishAssistant();
  keepBottom(stick);
  const usage = message.usage;
  if (usage && usage.totalTokens > 0) {
    updateContextUsage(usage.totalTokens, Number(contextLabel.dataset.window || 0));
  }
}

/** Заполнение контекста — только текущий ход (usage.totalTokens / contextUsage), не сумма сессии. */
function updateContextUsage(tokens, window) {
  if (!(tokens > 0) || !(window > 0)) return;
  contextLabel.textContent = t("{n}% context", { n: Math.round((tokens / window) * 100) });
}

/** Ход без текста, но с thinking (ответ, который сразу ушёл в tool call) не выбрасываем:
 *  иначе блок размышлений исчезает сразу после того, как модель додумала. */
function finishAssistant() {
  if (assistantBlock && !assistantBlock.text.dataset.raw && !assistantBlock.thinking?.textContent) {
    assistantBlock.wrap.remove();
  }
  assistantBlock = null;
}

function onToolStart(frame) {
  finishAssistant();
  liveContentSeen = true;
  const name = frame.toolName || "tool";
  const stick = stickBefore();
  const entry = createToolCard(name, summarizeArgs(frame.args), commandOf(name, frame.args));
  entry.status.textContent = "…";
  toolCards.set(frame.toolCallId, entry);
  keepBottom(stick);
}

/** Поле под шапкой раскрытой карточки: у bash — команда, у прочих инструментов — все аргументы JSON. */
function commandOf(name, args) {
  if (!args || typeof args !== "object") return "";
  if (name === "bash") {
    return typeof args.command === "string" && args.command.trim() ? args.command : "";
  }
  if (Object.keys(args).length === 0) return "";
  return JSON.stringify(args, null, 2);
}

/** Карточка инструмента: шапка кликабельна, тело — команда (bash) и вывод, сворачивается по клику/Enter/Space. */
function createToolCard(nameText, argsText, commandText) {
  const card = document.createElement("div");
  card.className = "tool";
  const head = document.createElement("div");
  head.className = "head";
  head.tabIndex = 0;
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = "▸";
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = nameText;
  const args = document.createElement("span");
  args.className = "args";
  args.textContent = argsText;
  const status = document.createElement("span");
  status.className = "status";
  head.append(caret, name, args, status);
  const body = document.createElement("div");
  body.className = "body";
  body.hidden = true;
  if (commandText) {
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = t("Command");
    const command = document.createElement("pre");
    command.className = "command";
    command.textContent = commandText;
    body.append(label, command);
  }
  const pre = document.createElement("pre");
  pre.className = "output";
  pre.hidden = true;
  body.append(pre);
  card.append(head, body);
  const entry = { card, body, pre, status, caret, args, argsText, command: commandText, expanded: false };
  const toggle = () => {
    entry.expanded = !entry.expanded;
    applyExpanded(entry);
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
  stream.append(card);
  return entry;
}

function applyExpanded(entry) {
  entry.body.hidden = !entry.expanded;
  entry.caret.textContent = entry.expanded ? "▾" : "▸";
  entry.card.classList.toggle("expanded", entry.expanded);
  if (entry.command) entry.args.textContent = entry.expanded ? entry.command.replace(/\s+/g, " ").trim() : entry.argsText;
}

/** Вывод кладётся в тело всегда, но карточка остаётся свёрнутой — раскрывает пользователь. */
function showToolOutput(entry, text) {
  if (!text) return;
  entry.pre.textContent = text;
  entry.pre.hidden = false;
}

function onToolUpdate(frame) {
  const entry = toolCards.get(frame.toolCallId);
  if (!entry) return;
  const stick = stickBefore();
  showToolOutput(entry, contentText(frame.partialResult));
  keepBottom(stick);
}

function onToolEnd(frame) {
  const entry = toolCards.get(frame.toolCallId);
  if (!entry) return;
  const stick = stickBefore();
  entry.status.textContent = frame.isError ? "✗" : "✓";
  entry.status.classList.add(frame.isError ? "err" : "ok");
  showToolOutput(entry, contentText(frame.result));
  keepBottom(stick);
}

function onQueue(frame) {
  const parts = [];
  (frame.steering || []).forEach((text) => parts.push(`${t("steer")}: ${text}`));
  (frame.followUp || []).forEach((text) => parts.push(`${t("follow-up")}: ${text}`));
  queueLabel.textContent = parts.join(" · ");
}

/** Очередь обработана или вкладка сменилась — подпись снимаем, иначе она висит чужой сессией. */
function clearQueue() {
  queueLabel.textContent = "";
}

/** Задачи плана (виджеты pi-todo / plan-todos) — свёрнутая панель над композером. */
function onTodos(frame) {
  todos = Array.isArray(frame.items) ? frame.items : [];
  renderTodos();
}

function renderTodos() {
  todoPanel.innerHTML = "";
  todoPanel.hidden = todos.length === 0;
  if (!todos.length) return;
  const done = todos.filter((item) => item.status === "completed").length;
  const current = todos.find((item) => item.status === "in_progress");
  const head = document.createElement("button");
  head.type = "button";
  head.className = "todo-head";
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = todoExpanded ? "▾" : "▸";
  const title = document.createElement("span");
  title.className = "todo-title";
  title.textContent = t("Plan");
  const counter = document.createElement("span");
  counter.className = "todo-counter";
  counter.textContent = `${done} / ${todos.length}`;
  head.append(caret, title, counter);
  if (!todoExpanded && current) {
    const summary = document.createElement("span");
    summary.className = "todo-summary";
    summary.textContent = current.content;
    head.append(summary);
  }
  head.addEventListener("click", () => {
    todoExpanded = !todoExpanded;
    renderTodos();
  });
  const bar = document.createElement("div");
  bar.className = "todo-bar";
  const fill = document.createElement("div");
  fill.className = "todo-fill";
  fill.style.width = `${(done / todos.length) * 100}%`;
  bar.append(fill);
  todoPanel.append(head, bar);
  if (!todoExpanded) return;
  const body = document.createElement("div");
  body.className = "todo-body";
  todos.forEach((item) => {
    const row = document.createElement("div");
    row.className = `todo-row ${item.status}`;
    const icon = document.createElement("span");
    icon.className = "todo-icon";
    icon.textContent = item.status === "completed" ? "✓" : item.status === "in_progress" ? "▶" : "○";
    const text = document.createElement("span");
    text.className = "todo-text";
    text.textContent = item.content;
    row.append(icon, text);
    body.append(row);
  });
  todoPanel.append(body);
}

function onSessionName(frame) {
  if (!attached || !frame.name) return;
  attached.title = frame.name;
  const tab = tabs.querySelector(`[data-id="${attached.id}"] .label`);
  if (tab) tab.textContent = frame.name;
}

function renderHistory(messages) {
  stream.innerHTML = "";
  toolCards.clear();
  messages.forEach((message) => {
    if (message.role === "user") {
      addUserMessage(message);
      return;
    }
    if (message.role === "assistant") {
      const thinking = (message.content || [])
        .filter((block) => block.type === "thinking")
        .map((block) => block.thinking)
        .join("");
      const text = (message.content || [])
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      const wrap = document.createElement("div");
      wrap.className = "msg assistant";
      if (thinking) {
        const details = document.createElement("details");
        details.className = "thinking";
        const summary = document.createElement("summary");
        summary.textContent = t("Thinking…");
        const body = document.createElement("div");
        body.className = "body";
        body.textContent = thinking;
        details.append(summary, body);
        wrap.append(details);
      }
      if (text) {
        const textEl = document.createElement("div");
        textEl.className = "text";
        textEl.innerHTML = markdown(text);
        wrap.append(textEl);
      }
      if (wrap.childNodes.length) stream.append(wrap);
      (message.content || [])
        .filter((block) => block.type === "toolCall")
        .forEach((block) => addHistoryTool(block));
      return;
    }
    if (message.role === "toolResult") {
      const entry = toolCards.get(message.toolCallId);
      const text = contentText(message);
      if (entry) {
        entry.status.textContent = message.isError ? "✗" : "✓";
        entry.status.classList.add(message.isError ? "err" : "ok");
        showToolOutput(entry, text);
      }
    }
  });
  scrollToBottom();
}

function addHistoryTool(block) {
  const name = block.name || "tool";
  const entry = createToolCard(name, summarizeArgs(block.arguments), commandOf(name, block.arguments));
  toolCards.set(block.id, entry);
}

function addUser(text) {
  liveContentSeen = true;
  const bubble = document.createElement("div");
  bubble.className = "msg user";
  bubble.textContent = text;
  stream.append(bubble);
}

/** Текст промпта + пометка о картинках; без картинок — только текст. */
function addUserMessage(message) {
  const content = message.content || [];
  const text = content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const images = content.filter((block) => block.type === "image").length;
  if (!text && !images) return;
  addUser(images ? `${text}${text ? " " : ""}${t("[image]")}` : text);
}

function addInfo(text, isError) {
  const line = document.createElement("div");
  line.className = isError ? "error" : "info";
  line.textContent = text;
  const stick = stickBefore();
  stream.append(line);
  keepBottom(stick);
}

const STICK_THRESHOLD = 48;
let fingerDown = false;

function atBottom() {
  return stream.scrollHeight - stream.scrollTop - stream.clientHeight <= STICK_THRESHOLD;
}

// Палец на ленте — прокрутку не трогаем, даже если лента растёт.
stream.addEventListener("pointerdown", () => {
  fingerDown = true;
});
["pointerup", "pointercancel"].forEach((type) =>
  window.addEventListener(type, () => {
    fingerDown = false;
  }),
);

/** Позиция до вставки: true — пользователь у низа, лента должна ехать за ответом. */
function stickBefore() {
  return !fingerDown && atBottom();
}

/** После вставки: держим низ, только если до неё пользователь был у низа. */
function keepBottom(stick) {
  if (stick) stream.scrollTop = stream.scrollHeight;
}

/** Принудительный прыжок вниз: своё сообщение, история, attach. */
function scrollToBottom() {
  stream.scrollTop = stream.scrollHeight;
}

function summarizeArgs(args) {
  if (!args) return "";
  const keys = Object.keys(args);
  if (keys.length === 0) return "";
  const first = args[keys[0]];
  const text = typeof first === "string" ? first : JSON.stringify(first);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function contentText(payload) {
  if (!payload) return "";
  if (typeof payload === "string") return payload;
  const content = payload.content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block.type === "text" ? block.text : block.type === "image" ? t("[image]") : ""))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof payload.text === "string") return payload.text;
  return "";
}

// ------------------------------------------------------------------ dialogs

function onUiRequest(frame) {
  const method = frame.method;
  if (method === "notify") {
    addInfo(frame.message || frame.title || "", frame.level === "error" || frame.isError === true);
    return;
  }
  if (method === "setStatus" || method === "setWidget" || method === "setTitle" || method === "set_editor_text") {
    return;
  }
  // Один запрос может прийти и live-броадкастом, и реплеем при attach — карточку рисуем один раз.
  if (frame.id && openDialogs.has(frame.id)) return;
  if (method === "input" && typeof frame.title === "string" && frame.title.startsWith(ASK_PREFIX)) {
    renderAsk(frame);
    return;
  }
  if (method === "confirm") return renderConfirm(frame);
  if (method === "select") return renderSelect(frame);
  if (method === "input") return renderInput(frame);
  if (method === "editor") return renderEditor(frame);
  renderUnknown(frame);
}

// Неизвестный метод не отвечаем сами: молчаливый cancelled может отклонить разрешение,
// которое пользователь хотел дать. Показываем запрос и даём ответить с ПК.
function renderUnknown(frame) {
  const { card, body, close } = dialogShell(frame.title || t("Extension request"));
  const text = document.createElement("p");
  text.textContent = t("Method \"{method}\" can't be shown on the phone. Answer on the PC.", { method: frame.method });
  body.append(text);
  const pre = document.createElement("pre");
  pre.className = "md-code";
  pre.textContent = JSON.stringify(frame, null, 2);
  body.append(pre);
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(button(t("Cancel"), () => respondUi(frame.id, { cancelled: true }), true));
  body.append(actions);
  registerDialog(frame.id, card, close);
  scheduleDialogTimeout(frame.id, frame.timeout);
}

/** Карточка диалога: шапка-шеврон сворачивает её до одной строки, чтобы не перекрывать ленту. */
function dialogShell(title, summary) {
  const card = document.createElement("div");
  card.className = "dialog";
  const head = document.createElement("button");
  head.type = "button";
  head.className = "dialog-head";
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.textContent = "▾";
  const heading = document.createElement("h3");
  heading.textContent = title || t("pi asks");
  head.append(caret, heading);
  if (summary) {
    const note = document.createElement("span");
    note.className = "summary";
    note.textContent = summary;
    head.append(note);
  }
  const body = document.createElement("div");
  body.className = "dialog-body";
  card.append(head, body);
  dialogs.append(card);
  head.addEventListener("click", () => {
    const collapsed = card.classList.toggle("collapsed");
    caret.textContent = collapsed ? "▸" : "▾";
  });
  const close = () => card.remove();
  return { card, body, close };
}

function registerDialog(id, card, close) {
  card.dataset.id = id;
  openDialogs.set(id, { card, close });
}

function scheduleDialogTimeout(id, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return;
  setTimeout(() => {
    const entry = openDialogs.get(id);
    if (!entry) return;
    entry.close();
    openDialogs.delete(id);
    addInfo(t("Timed out — pi used the default answer"));
  }, timeoutMs);
}

function respondUi(id, answer) {
  send({ type: "ui_response", id, answer });
  const entry = openDialogs.get(id);
  if (entry) {
    entry.close();
    openDialogs.delete(id);
  }
}

function renderConfirm(frame) {
  const { card, body, close } = dialogShell(frame.title);
  if (frame.message) {
    const text = document.createElement("p");
    text.textContent = frame.message;
    body.append(text);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  const yes = button(t("Yes"), () => respondUi(frame.id, { confirmed: true }));
  const no = button(t("No"), () => respondUi(frame.id, { confirmed: false }));
  const cancel = button(t("Cancel"), () => respondUi(frame.id, { cancelled: true }), true);
  actions.append(yes, no, cancel);
  body.append(actions);
  registerDialog(frame.id, card, close);
  scheduleDialogTimeout(frame.id, frame.timeout);
}

function renderSelect(frame) {
  const title = typeof frame.title === "string" ? frame.title : "";
  const nl = title.indexOf("\n");
  const header = nl < 0 ? title : title.slice(0, nl);
  const bodyText = nl < 0 ? "" : title.slice(nl + 1).trim();
  const { card, body, close } = dialogShell(header);
  if (bodyText) {
    const pre = document.createElement("pre");
    pre.className = "md-code";
    pre.textContent = bodyText;
    body.append(pre);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  (frame.options || []).forEach((option) => {
    actions.append(button(option, () => respondUi(frame.id, { value: option })));
  });
  actions.append(button(t("Cancel"), () => respondUi(frame.id, { cancelled: true }), true));
  body.append(actions);
  registerDialog(frame.id, card, close);
  scheduleDialogTimeout(frame.id, frame.timeout);
}

function renderInput(frame) {
  const { card, body, close } = dialogShell(frame.title);
  const field = document.createElement("input");
  field.type = "text";
  field.placeholder = frame.placeholder || "";
  body.append(field);
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    button(t("OK"), () => respondUi(frame.id, { value: field.value })),
    button(t("Cancel"), () => respondUi(frame.id, { cancelled: true }), true),
  );
  body.append(actions);
  registerDialog(frame.id, card, close);
  scheduleDialogTimeout(frame.id, frame.timeout);
  field.focus();
}

function renderEditor(frame) {
  const { card, body, close } = dialogShell(frame.title);
  const area = document.createElement("textarea");
  area.value = frame.prefill || "";
  body.append(area);
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    button(t("OK"), () => respondUi(frame.id, { value: area.value })),
    button(t("Cancel"), () => respondUi(frame.id, { cancelled: true }), true),
  );
  body.append(actions);
  registerDialog(frame.id, card, close);
  scheduleDialogTimeout(frame.id, frame.timeout);
}

function decodeAsk(title) {
  const base64 = title.slice(ASK_PREFIX.length);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(json);
  return parsed.questions || [];
}

function renderAsk(frame) {
  let questions;
  try {
    questions = decodeAsk(frame.title);
  } catch {
    renderInput(frame);
    return;
  }
  const { card, body, close } = dialogShell(t("Agent questions"), t("{n} q.", { n: questions.length }));
  const state = questions.map((question) => ({
    question,
    selected: question.multiSelect ? [] : null,
    custom: "",
    notes: false,
    note: "",
  }));

  state.forEach((entry, index) => {
    const block = document.createElement("div");
    block.className = "q";
    if (entry.question.header) {
      const header = document.createElement("div");
      header.className = "header";
      header.textContent = entry.question.header;
      block.append(header);
    }
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = entry.question.question;
    block.append(text);

    (entry.question.options || []).forEach((option) => {
      const opt = document.createElement("button");
      opt.className = "opt";
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = option.label;
      opt.append(label);
      if (option.description) {
        const desc = document.createElement("div");
        desc.className = "desc";
        desc.textContent = option.description;
        opt.append(desc);
      }
      if (option.recommendedReason) {
        const why = document.createElement("div");
        why.className = "why";
        why.textContent = `Why: ${option.recommendedReason}`;
        opt.append(why);
      }
      opt.addEventListener("click", () => {
        if (entry.question.multiSelect) {
          const at = entry.selected.indexOf(option.label);
          if (at >= 0) entry.selected.splice(at, 1);
          else entry.selected.push(option.label);
          opt.classList.toggle("sel");
        } else {
          entry.selected = option.label;
          block.querySelectorAll(".opt").forEach((node) => node.classList.remove("sel"));
          opt.classList.add("sel");
        }
      });
      block.append(opt);
    });

    const custom = document.createElement("input");
    custom.type = "text";
    custom.placeholder = t("Own answer");
    custom.addEventListener("input", () => {
      entry.custom = custom.value;
    });
    block.append(custom);

    const noteToggle = document.createElement("button");
    noteToggle.type = "button";
    noteToggle.className = "note-toggle";
    noteToggle.textContent = "✎ " + t("Add note");
    const noteField = document.createElement("input");
    noteField.type = "text";
    noteField.className = "note-field";
    noteField.placeholder = t("Note to answer…");
    noteField.hidden = true;
    noteToggle.addEventListener("click", () => {
      noteField.hidden = !noteField.hidden;
      noteToggle.textContent = noteField.hidden ? "✎ " + t("Add note") : "✎ " + t("Remove note");
      if (!noteField.hidden) noteField.focus();
    });
    noteField.addEventListener("input", () => {
      entry.note = noteField.value;
    });
    block.append(noteToggle, noteField);

    const notes = document.createElement("label");
    notes.className = "notes";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.addEventListener("change", () => {
      entry.notes = checkbox.checked;
    });
    notes.append(checkbox, document.createTextNode(t("Needs clarification")));
    block.append(notes);

    body.append(block);
  });

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    button(t("Submit"), () => {
      const answers = state.map((entry, index) => {
        const question = entry.question;
        const answer = { questionIndex: index, question: question.question };
        if (entry.notes) {
          answer.kind = "chat";
        } else {
          if (question.multiSelect) {
            answer.kind = "multi";
            answer.selected = entry.selected || [];
            if (entry.custom) answer.answer = entry.custom;
          } else if (entry.custom) {
            answer.kind = "custom";
            answer.answer = entry.custom;
          } else {
            answer.kind = "option";
            answer.answer = entry.selected || (question.options[0] || {}).label || "";
          }
          const note = entry.note.trim();
          if (note) answer.notes = note;
        }
        return answer;
      });
      respondUi(frame.id, { value: JSON.stringify({ answers, cancelled: false }) });
    }),
    button(t("Cancel"), () => respondUi(frame.id, { cancelled: true }), true),
  );
  body.append(actions);
  registerDialog(frame.id, card, close);
  scheduleDialogTimeout(frame.id, frame.timeout);
}

function onUiAnswered(frame) {
  const entry = openDialogs.get(frame.id);
  if (!entry) return;
  entry.close();
  openDialogs.delete(frame.id);
  addInfo(frame.by === "pc" ? t("PC answered") : t("Phone answered"));
}

function button(label, onClick, ghost) {
  const node = document.createElement("button");
  node.textContent = label;
  if (ghost) node.className = "ghost";
  node.addEventListener("click", onClick);
  return node;
}

// ------------------------------------------------------------------ composer

sendButton.addEventListener("click", () => sendPrompt());
steerButton.addEventListener("click", () => sendPrompt("steer"));
stopButton.addEventListener("click", () => send({ type: "abort" }));

// ------------------------------------------------------------ hide tools

/** Скрытие тулов — своё у каждой сессии: состояние помнится по id вкладки. */
hideToolsButton.addEventListener("click", () => {
  toolsHidden = !toolsHidden;
  if (attached) hideToolsBySession.set(attached.id, toolsHidden);
  applyToolsHidden();
});

function applyToolsHidden() {
  stream.classList.toggle("hide-tools", toolsHidden);
  hideToolsButton.innerHTML = toolsHidden ? EYE_OFF_SVG : EYE_SVG;
  hideToolsButton.title = toolsHidden ? t("Show tool blocks") : t("Hide tool blocks");
}

// -------------------------------------------------------------- read mode

/** Режим чтения: только лента — вкладки, проект/модель/контекст, план и композер скрыты. */
readModeButton.addEventListener("click", () => setReadMode(!readMode));
readExitButton.addEventListener("click", () => setReadMode(false));

function setReadMode(value) {
  readMode = value;
  document.body.classList.toggle("read-mode", value);
  readExitButton.hidden = !value;
  readModeButton.innerHTML = BOOK_SVG;
  readExitButton.innerHTML = BOOK_SVG;
  readModeButton.title = value ? t("Exit read mode") : t("Read mode");
}

setReadMode(false);

// ----------------------------------------------------------- telegram notify

/** Тоггл уведомлений в Telegram — своё у каждой сессии, состояние приходит в sessions/attached. */
tgNotifyButton.addEventListener("click", () => {
  if (!attached) return;
  tgEnabled = !tgEnabled;
  applyTgNotify();
  send({ type: "telegram", enabled: tgEnabled });
});

function applyTgNotify() {
  tgNotifyButton.disabled = !attached;
  tgNotifyButton.innerHTML = tgEnabled ? TG_SVG : TG_OFF_SVG;
  tgNotifyButton.title = tgEnabled
    ? t("Telegram notifications on")
    : t("Telegram notifications off");
}

applyTgNotify();

// ---------------------------------------------------------------- attachments

attachButton.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  addFiles([...fileInput.files]);
  fileInput.value = "";
});

/** Модель без `input: image` картинку не примет — кнопка гаснет, вложения снимаются. */
function updateAttachButton() {
  const allowed = !!attached && modelSupportsImages;
  attachButton.disabled = !allowed;
  attachButton.title = modelSupportsImages
    ? t("Attach image")
    : t("Model does not accept images");
  if (!modelSupportsImages && pendingImages.length) {
    pendingImages = [];
    renderChips();
    addInfo(t("Model does not accept images — attachments removed"), true);
  }
}

async function addFiles(files) {
  for (const file of files) {
    if (pendingImages.length >= MAX_IMAGES) {
      addInfo(t("Max {n} images", { n: MAX_IMAGES }), true);
      break;
    }
    if (!file.type.startsWith("image/")) continue;
    try {
      pendingImages.push(await shrinkImage(file));
    } catch {
      addInfo(t("Image unreadable or too large"), true);
    }
  }
  renderChips();
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode failed"));
    };
    image.src = url;
  });
}

/** Ужать до 1600 px по длинной стороне и JPEG: base64 должен влезть в кадр WS. */
async function shrinkImage(file) {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  for (const quality of JPEG_QUALITIES) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_IMAGE_CHARS) {
      return { data: url.slice(url.indexOf(",") + 1), mimeType: "image/jpeg", url };
    }
  }
  throw new Error("too large");
}

function renderChips() {
  chips.innerHTML = "";
  chips.hidden = pendingImages.length === 0;
  pendingImages.forEach((image, index) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const thumb = document.createElement("img");
    thumb.src = image.url;
    thumb.alt = "";
    const remove = document.createElement("button");
    remove.className = "x";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      pendingImages.splice(index, 1);
      renderChips();
    });
    chip.append(thumb, remove);
    chips.append(chip);
  });
}

function sendPrompt(behavior) {
  const text = input.value.trim();
  if (!text || !attached) return;
  const startingLoop = loopsEnabled && loopEnabled && !(loopInfo && loopInfo.active);
  input.value = "";
  draftBySession.set(attached.id, "");
  autoGrow();
  const frame = { type: "prompt", text };
  if (behavior) frame.behavior = behavior;
  if (startingLoop) {
    frame.loop = { max: loopMax, exit: loopExitInput.value.trim() };
    loopEnabled = false;
    loopEnabledBySession.set(attached.id, false);
    applyLoopUi();
  }
  if (pendingImages.length) {
    frame.images = pendingImages.map((image) => ({ data: image.data, mimeType: image.mimeType }));
    pendingImages = [];
    renderChips();
  }
  send(frame);
}

function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`;
}
input.addEventListener("input", () => {
  autoGrow();
  if (attached) draftBySession.set(attached.id, input.value);
});

// ---------------------------------------------------------------------- loop

const LOOP_REASON_KEY = {
  agent: "the turn had no tool calls",
  exit: "exit condition met",
  user: "stopped by user",
  max: "iteration limit reached",
  "short-circuit": "3 iterations in a row faster than 10 seconds",
  error: "failed to start the next iteration"
};

function onLoopState(frame) {
  if (attached && frame.id !== attached.id) return;
  loopInfo = frame.info || null;
  applyLoopUi();
}

function applyLoopUi() {
  loopBar.hidden = !loopsEnabled;
  if (!loopsEnabled) {
    loopExitInput.hidden = true;
    loopInfoLabel.textContent = "";
    return;
  }
  const active = !!(loopInfo && loopInfo.active);
  loopCheck.checked = active || loopEnabled;
  loopMaxInput.hidden = !loopCheck.checked;
  loopMaxInput.value = String(active ? loopInfo.remaining : loopMax);
  loopExitInput.hidden = !loopEnabled || active;
  if (loopInfo && !active && loopInfo.reason) {
    loopInfoLabel.textContent = t("stopped: {reason}", { reason: t(LOOP_REASON_KEY[loopInfo.reason] || loopInfo.reason) });
  } else if (active) {
    loopInfoLabel.textContent = t("active");
  } else {
    loopInfoLabel.textContent = "";
  }
}

loopCheck.addEventListener("change", () => {
  if (!attached) return;
  if (loopInfo && loopInfo.active) {
    loopCheck.checked = true;
    send({ type: "loop_stop" });
    return;
  }
  loopEnabled = loopCheck.checked;
  loopEnabledBySession.set(attached.id, loopEnabled);
  applyLoopUi();
  if (loopEnabled) loopExitInput.focus();
});

loopMaxInput.addEventListener("change", () => {
  const value = Math.round(Number(loopMaxInput.value));
  if (!Number.isFinite(value)) return;
  loopMax = Math.min(999, Math.max(1, value));
  loopMaxInput.value = String(loopMax);
  if (attached && loopInfo && loopInfo.active) send({ type: "loop_set_remaining", remaining: loopMax });
});

// -------------------------------------------------------------- create session

function onSessionCreated(frame) {
  if (frame.id) attach(frame.id);
}

function openCreateDialog() {
  createForm.reset();
  fillProjectSelect();
  resetCatalogSelects();
  const frame = { type: "catalog" };
  if (createProject.value) frame.project = createProject.value;
  send(frame);
  createOverlay.hidden = false;
  createName.focus();
}

function closeCreateDialog() {
  createOverlay.hidden = true;
}

/** Селект проектов: показывается, только когда remote-вкладки в нескольких проектах. */
function fillProjectSelect() {
  const projects = [...new Set(lastSessions.map((session) => session.project).filter(Boolean))];
  createProject.innerHTML = "";
  projects.forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    createProject.append(opt);
  });
  createProjectRow.hidden = projects.length <= 1;
  createProject.hidden = projects.length <= 1;
}

function resetCatalogSelects() {
  catalogModels = [];
  catalogThinking = [];
  createModel.innerHTML = "";
  createThinking.innerHTML = "";
  addDefaultOption(createModel);
  addDefaultOption(createThinking);
  createThinkingRow.hidden = true;
}

function addDefaultOption(select) {
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = t("Default");
  select.append(opt);
  select.value = "";
}

function onCatalog(frame) {
  if (createOverlay.hidden) return;
  catalogModels = frame.models || [];
  catalogThinking = frame.thinkingLevels || [];
  fillModelSelect(catalogModels, frame.defaultModel);
  fillThinkingSelect(thinkingLevelsFor(createModel.value), frame.defaultThinking);
}

/** Уровни thinking модели [key]; если их нет (кэш настроек старых версий) — общий список из кадра. */
function thinkingLevelsFor(key) {
  const levels = catalogModels.find((model) => model.key === key)?.thinkingLevels;
  return levels && levels.length ? levels : catalogThinking;
}

function fillModelSelect(models, defaultModel) {
  createModel.innerHTML = "";
  addDefaultOption(createModel);
  let provider = null;
  let group = null;
  models.forEach((model) => {
    if (model.provider !== provider) {
      provider = model.provider;
      group = document.createElement("optgroup");
      group.label = provider || "models";
      createModel.append(group);
    }
    const opt = document.createElement("option");
    opt.value = model.key;
    opt.textContent = model.name || model.key;
    group.append(opt);
  });
  createModel.value = defaultModel || "";
  if (createModel.value !== (defaultModel || "")) createModel.value = "";
}

function fillThinkingSelect(levels, defaultThinking) {
  createThinking.innerHTML = "";
  addDefaultOption(createThinking);
  levels.forEach((level) => {
    const opt = document.createElement("option");
    opt.value = level;
    opt.textContent = level;
    createThinking.append(opt);
  });
  createThinkingRow.hidden = levels.length === 0;
  createThinking.value = defaultThinking || "";
  if (createThinking.value !== (defaultThinking || "")) createThinking.value = "";
}

// Уровни thinking относятся к конкретной модели — общий список из кадра годится лишь для выбранной
// при открытии формы, поэтому при смене модели селект перечитываем целиком.
createModel.addEventListener("change", () => {
  const levels = thinkingLevelsFor(createModel.value);
  const keep = levels.includes(createThinking.value) ? createThinking.value : "";
  fillThinkingSelect(levels, keep);
});

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const frame = { type: "create_session", name: createName.value.trim() };
  if (createModel.value) frame.model = createModel.value;
  if (createThinking.value) frame.thinking = createThinking.value;
  if (!createProjectRow.hidden && createProject.value) frame.project = createProject.value;
  send(frame);
  closeCreateDialog();
});
createCancel.addEventListener("click", closeCreateDialog);
createOverlay.addEventListener("click", (event) => {
  if (event.target === createOverlay) closeCreateDialog();
});

// ------------------------------------------------------------------ kanban

menuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  mainMenu.hidden = !mainMenu.hidden;
});
document.addEventListener("click", (event) => {
  if (mainMenu.hidden) return;
  if (event.target === menuButton || mainMenu.contains(event.target)) return;
  mainMenu.hidden = true;
});
menuNewSession.addEventListener("click", () => {
  mainMenu.hidden = true;
  openCreateDialog();
});
menuKanban.addEventListener("click", () => {
  mainMenu.hidden = true;
  openBoardsDialog();
});

/** Список досок всех открытых проектов; клик — вкладка с деревом доски. */
function openBoardsDialog() {
  const { body, close } = openModal(t("Kanban"));
  const loading = document.createElement("div");
  loading.className = "info";
  loading.textContent = "…";
  body.append(loading);
  request({ type: "kanban_boards" }, (frame) => {
    if (!document.body.contains(body)) return;
    body.innerHTML = "";
    kanbanLoopsEnabled = frame.loopsEnabled === true;
    const boards = frame.boards || [];
    if (!boards.length) {
      const empty = document.createElement("div");
      empty.className = "info";
      empty.textContent = t("No boards");
      body.append(empty);
      return;
    }
    let lastProject = null;
    boards.forEach((board) => {
      if (board.project !== lastProject) {
        lastProject = board.project;
        const head = document.createElement("div");
        head.className = "kb-project";
        head.textContent = board.project;
        body.append(head);
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "menu-item";
      const count = document.createElement("span");
      count.className = "kb-count";
      count.textContent = String(board.cards);
      row.append(count, document.createTextNode(board.name));
      row.addEventListener("click", () => {
        close();
        openBoardTab(board.project, board.boardId, board.name);
      });
      body.append(row);
    });
  });
}

function renderKanbanView() {
  if (!kanbanState) return;
  kanbanMain.innerHTML = "";
  if (!kanbanState.board) {
    const line = document.createElement("div");
    line.className = kanbanState.error ? "error" : "info";
    line.textContent = kanbanState.error || "…";
    kanbanMain.append(line);
    return;
  }
  if (kanbanState.kind === "board") renderBoardTree();
  else renderCardView();
}

/** Дерево доски как в боковой панели ПК: колонки-секции со сворачиванием, внутри — задачи. */
function renderBoardTree() {
  const board = kanbanState.board;
  const head = document.createElement("div");
  head.className = "kb-head";
  const name = document.createElement("span");
  name.className = "kb-board-name";
  name.textContent = board.name;
  const proj = document.createElement("span");
  proj.className = "kb-board-project";
  proj.textContent = kanbanState.project;
  head.append(name, proj);
  kanbanMain.append(head);
  const columns = document.createElement("div");
  columns.className = "kb-columns";
  board.columns.forEach((column) => {
    const cards = board.cards.filter((card) => card.columnId === column.id).sort((a, b) => a.order - b.order);
    const collapsed = kanbanState.collapsed.has(column.id);
    const col = document.createElement("div");
    col.className = "kb-col";
    const colHead = document.createElement("div");
    colHead.className = "kb-col-head";
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "kb-caret";
    caret.textContent = collapsed ? "▸" : "▾";
    const toggle = () => {
      if (collapsed) kanbanState.collapsed.delete(column.id);
      else kanbanState.collapsed.add(column.id);
      renderKanbanView();
    };
    caret.addEventListener("click", toggle);
    const colName = document.createElement("button");
    colName.type = "button";
    colName.className = "kb-col-name";
    colName.textContent = column.name;
    colName.addEventListener("click", toggle);
    const count = document.createElement("span");
    count.className = "kb-count";
    count.textContent = String(cards.length);
    colHead.append(caret, colName, count);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "kb-col-btn";
    add.textContent = "+";
    add.title = t("Add task");
    add.addEventListener("click", () => openCreateCardDialog(column));
    colHead.append(add);
    if (kanbanLoopsEnabled) {
      const menu = document.createElement("button");
      menu.type = "button";
      menu.className = "kb-col-btn";
      menu.textContent = "⋯";
      menu.title = t("Column menu");
      menu.addEventListener("click", () => openColumnMenu(column, cards.length));
      colHead.append(menu);
    }
    col.append(colHead);
    if (!collapsed) {
      cards.forEach((card) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "kb-card";
        const title = document.createElement("span");
        title.className = "kb-card-title";
        title.textContent = card.title;
        row.append(title);
        const badges = [];
        if (card.comments.length) badges.push("💬" + card.comments.length);
        if (card.images.length) badges.push("🖼" + card.images.length);
        if (badges.length) {
          const badge = document.createElement("span");
          badge.className = "kb-badges";
          badge.textContent = badges.join(" ");
          row.append(badge);
        }
        row.addEventListener("click", () => openCardTab(kanbanState.project, board.id, card));
        col.append(row);
      });
    }
    columns.append(col);
  });
  kanbanMain.append(columns);
}

/** Петли колонки (как на ПК): пока есть задачи / точное количество. */
function openColumnMenu(column, count) {
  const { body, close } = openModal(t("Column menu"));
  const whileBtn = document.createElement("button");
  whileBtn.type = "button";
  whileBtn.className = "menu-item";
  whileBtn.textContent = t("Loop: while there are tasks");
  whileBtn.addEventListener("click", () => {
    close();
    send({ type: "kanban_loop", project: kanbanState.project, boardId: kanbanState.boardId, columnId: column.id, mode: "while" });
  });
  const countBtn = document.createElement("button");
  countBtn.type = "button";
  countBtn.className = "menu-item";
  countBtn.textContent = `${t("Loop: exact count")} (${count})`;
  countBtn.addEventListener("click", () => {
    close();
    send({ type: "kanban_loop", project: kanbanState.project, boardId: kanbanState.boardId, columnId: column.id, mode: "count" });
  });
  body.append(whileBtn, countBtn);
}

function openCreateCardDialog(column) {
  const { body, close } = openModal(`${t("Add task")} — ${column.name}`);
  const title = document.createElement("input");
  title.type = "text";
  title.maxLength = 300;
  title.placeholder = t("Card title");
  const desc = document.createElement("textarea");
  desc.rows = 4;
  desc.placeholder = t("Description");
  const submit = () => {
    const text = title.value.trim();
    if (!text) return;
    const frame = { type: "kanban_card_create", project: kanbanState.project, boardId: kanbanState.boardId, columnId: column.id, title: text };
    if (desc.value.trim()) frame.description = desc.value.trim();
    request(frame, applyKanbanBoardResponse);
    close();
  };
  title.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  });
  body.append(title, desc, actionsRow(button(t("Cancel"), close, true), button(t("Create"), submit)));
  title.focus();
}

/** Карточка как вкладка: селектор колонки, описание с правкой, комментарии, запуск в новой сессии. */
function renderCardView() {
  const board = kanbanState.board;
  const card = board.cards.find((item) => item.id === kanbanState.cardId);
  if (!card) {
    const line = document.createElement("div");
    line.className = "error";
    line.textContent = t("Card not found");
    kanbanMain.append(line);
    return;
  }
  const head = document.createElement("div");
  head.className = "kb-head";
  const title = document.createElement("span");
  title.className = "kb-card-big";
  title.textContent = card.title;
  head.append(title);
  kanbanMain.append(head);

  const colRow = document.createElement("div");
  colRow.className = "kb-col-row";
  const select = document.createElement("select");
  select.className = "kb-col-select";
  board.columns.forEach((column) => {
    const opt = document.createElement("option");
    opt.value = column.id;
    opt.textContent = column.name;
    select.append(opt);
  });
  select.value = card.columnId;
  select.addEventListener("change", () => {
    request(
      { type: "kanban_card_move", project: kanbanState.project, boardId: board.id, cardId: card.id, columnId: select.value },
      applyKanbanBoardResponse,
    );
  });
  colRow.append(select);
  const run = document.createElement("button");
  run.type = "button";
  run.className = "kb-run";
  run.textContent = t("Run in new session");
  run.addEventListener("click", () => {
    send({ type: "kanban_run", project: kanbanState.project, boardId: board.id, cardId: card.id });
  });
  colRow.append(run);
  kanbanMain.append(colRow);

  if (kanbanState.editing) {
    kanbanMain.append(renderCardEditor(card));
  } else {
    const desc = document.createElement("div");
    desc.className = "kb-desc";
    const descHead = document.createElement("div");
    descHead.className = "kb-desc-head";
    const label = document.createElement("span");
    label.className = "kb-label";
    label.textContent = t("Description");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "kb-col-btn";
    edit.textContent = "✎ " + t("Edit");
    edit.addEventListener("click", () => {
      kanbanState.editing = { title: card.title, description: card.description };
      renderKanbanView();
    });
    descHead.append(label, edit);
    desc.append(descHead);
    if (card.description) {
      const text = document.createElement("div");
      text.className = "kb-desc-text";
      text.innerHTML = markdown(card.description);
      desc.append(text);
    }
    kanbanMain.append(desc);
  }

  const comments = document.createElement("div");
  comments.className = "kb-comments";
  const commentsLabel = document.createElement("div");
  commentsLabel.className = "kb-label";
  commentsLabel.textContent = t("Comments");
  comments.append(commentsLabel);
  card.comments.forEach((comment) => {
    const item = document.createElement("div");
    item.className = "kb-comment";
    const meta = document.createElement("div");
    meta.className = "kb-comment-meta";
    meta.textContent = `${comment.author === "agent" ? "🤖" : "👤"} ${shortTime(comment.at)}`;
    const text = document.createElement("div");
    text.className = "kb-comment-text";
    text.innerHTML = markdown(comment.text);
    item.append(meta, text);
    comments.append(item);
  });
  const addBox = document.createElement("div");
  addBox.className = "kb-add-comment";
  const area = document.createElement("textarea");
  area.rows = 2;
  area.placeholder = t("Add comment");
  const add = document.createElement("button");
  add.textContent = t("Send");
  add.addEventListener("click", () => {
    const text = area.value.trim();
    if (!text) return;
    request(
      { type: "kanban_card_comment", project: kanbanState.project, boardId: board.id, cardId: card.id, text },
      (frame) => {
        area.value = "";
        applyKanbanBoardResponse(frame);
      },
    );
  });
  addBox.append(area, add);
  comments.append(addBox);
  kanbanMain.append(comments);
}

function renderCardEditor(card) {
  const wrap = document.createElement("div");
  wrap.className = "kb-desc kb-edit";
  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.maxLength = 300;
  titleInput.value = kanbanState.editing.title;
  titleInput.placeholder = t("Card title");
  const area = document.createElement("textarea");
  area.rows = 6;
  area.value = kanbanState.editing.description;
  area.placeholder = t("Description");
  titleInput.addEventListener("input", () => {
    kanbanState.editing.title = titleInput.value;
  });
  area.addEventListener("input", () => {
    kanbanState.editing.description = area.value;
  });
  const save = () => {
    const titleText = kanbanState.editing.title.trim();
    if (!titleText) return;
    const frame = {
      type: "kanban_card_update",
      project: kanbanState.project,
      boardId: kanbanState.boardId,
      cardId: card.id,
      title: titleText,
      description: kanbanState.editing.description,
    };
    kanbanState.editing = null;
    request(frame, applyKanbanBoardResponse);
  };
  wrap.append(
    titleInput,
    area,
    actionsRow(
      button(t("Cancel"), () => {
        kanbanState.editing = null;
        renderKanbanView();
      }, true),
      button(t("Save"), save),
    ),
  );
  return wrap;
}

function shortTime(at) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ------------------------------------------------------------------ markdown

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** Инлайн-разметка уже экранированного текста: код, жирный, курсив, ссылки. */
function inlineFormat(text) {
  return text
    .replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function isTableRow(line) {
  return typeof line === "string" && /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line) {
  return typeof line === "string" && /^\s*\|(\s*:?-{1,}:?\s*\|)+\s*$/.test(line);
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function tableHtml(header, rows) {
  const head = `<tr>${header.map((cell) => `<th>${inlineFormat(escapeHtml(cell))}</th>`).join("")}</tr>`;
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${inlineFormat(escapeHtml(cell))}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table class="md-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

/** GFM-таблица (шапка, `|---|`, строки тела) заменяется плейсхолдером, HTML строится после разметки. */
function extractTables(text, blocks) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableRow(lines[i]) || !isTableSeparator(lines[i + 1])) {
      out.push(lines[i]);
      continue;
    }
    const rows = [];
    let j = i + 2;
    while (j < lines.length && isTableRow(lines[j])) rows.push(splitRow(lines[j++]));
    blocks.push(tableHtml(splitRow(lines[i]), rows));
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(`\u0000BLOCK${blocks.length - 1}\u0000`, "");
    i = j - 1;
  }
  return out.join("\n");
}

function markdown(text) {
  if (!text) return "";
  const blocks = [];
  let prepared = text.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<div class="md-code-wrap"><pre class="md-code">${escapeHtml(code.replace(/\n$/, ""))}</pre><button type="button" class="md-copy-btn" title="${t("Copy")}"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H4.5A1.5 1.5 0 0 0 3 3.5v5A1.5 1.5 0 0 0 4.5 10h1"/></svg><svg class="check" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8.5 6.5 12 13 4.5"/></svg></button></div>`);
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });
  prepared = extractTables(prepared, blocks);
  prepared = inlineFormat(escapeHtml(prepared));
  prepared = prepared.replace(/^###### (.*)$/gm, "<h6>$1</h6>");
  prepared = prepared.replace(/^##### (.*)$/gm, "<h5>$1</h5>");
  prepared = prepared.replace(/^#### (.*)$/gm, "<h4>$1</h4>");
  prepared = prepared.replace(/^### (.*)$/gm, "<h3>$1</h3>");
  prepared = prepared.replace(/^## (.*)$/gm, "<h2>$1</h2>");
  prepared = prepared.replace(/^# (.*)$/gm, "<h1>$1</h1>");
  prepared = prepared.replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>");
  prepared = prepared.replace(/(?:<li>[\s\S]*?<\/li>\s*)+/g, (match) => `<ul>${match}</ul>`);
  prepared = prepared.replace(/\n{2,}/g, "</p><p>");
  prepared = `<p>${prepared.replace(/\n/g, "<br>")}</p>`;
  prepared = prepared.replace(/<p>(?:<br>|\s)*(\u0000BLOCK\d+\u0000)(?:<br>|\s)*<\/p>/g, "$1");
  prepared = prepared.replace(/<p>\s*<\/p>/g, "");
  prepared = prepared.replace(/\u0000BLOCK(\d+)\u0000/g, (_, index) => blocks[Number(index)]);
  return prepared;
}

connect();
applyI18n();
applyToolsHidden();

stream.addEventListener("click", (event) => {
  const btn = event.target.closest(".md-copy-btn");
  if (!btn) return;
  const pre = btn.parentElement && btn.parentElement.querySelector("pre.md-code");
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(() => {
    btn.classList.add("copied");
    setTimeout(() => btn.classList.remove("copied"), 1500);
  });
});
