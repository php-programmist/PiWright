/** Локализация UI: ключ — английская строка, значение — русский перевод (нет в словаре — ключ).
 *  Интерполяция `{name}`. Язык — settings.language (дефолт en). */
import { useMemo } from 'react'
import { useSessionsStore } from '../stores/sessions'
import type { UiLanguage } from '../../../shared/ipc-contracts'

const RU: Record<string, string> = {
  // App — вертикальный тулбар
  'Git': 'Git',
  'Files': 'Файлы',
  'Terminal': 'Терминал',
  'MCP servers': 'MCP-серверы',
  'Skills': 'Навыки',

  // Панель проектов
  'Projects': 'Проекты',
  'Add project': 'Добавить проект',
  'Add a project to start': 'Добавьте проект, чтобы начать',
  'Settings': 'Настройки',
  'Session history': 'История сессий',
  'New session': 'Новая сессия',
  'Remove project': 'Удалить проект',
  'Rename (or double-click title)': 'Переименовать (или двойной клик по названию)',
  'Close session': 'Закрыть сессию',
  'no active sessions': 'нет активных сессий',
  'history': 'история',
  'loading…': 'загрузка…',
  'no past sessions': 'нет прошлых сессий',
  'show less': 'свернуть',
  'show all ({count})': 'показать все ({count})',
  'Delete session from disk': 'Удалить сессию с диска',
  'Delete session "{title}" from disk?\n\nIts session file will be removed permanently.':
    'Удалить сессию «{title}» с диска?\n\nФайл сессии будет удалён безвозвратно.',
  'Unread turns': 'Непрочитанные ходы',
  'Working': 'Работает',
  'Need your answer': 'Ждёт вашего ответа',

  // Чат
  'idle': 'ожидание',
  'starting…': 'запуск…',
  'ready': 'готова',
  'streaming…': 'работает…',
  'disconnected': 'отключена',
  'error': 'ошибка',
  'thinking': 'размышления',
  'Create or pick a session on the left': 'Создайте или выберите сессию слева',
  'Queued': 'В очереди',
  'Clear all': 'Очистить всё',
  'Remove from queue': 'Убрать из очереди',
  'steer': 'подсказка',
  'follow-up': 'после хода',
  'Steer': 'Подсказать',
  "Deliver before the agent's next step instead of after the turn": 'Доставить до следующего шага агента, а не после хода',
  'Unmute sounds for this session': 'Включить звук для этой сессии',
  'Mute sounds for this session': 'Выключить звук для этой сессии',
  'Show tool blocks': 'Показать тул-блоки',
  'Hide tool blocks': 'Скрыть тул-блоки',
  'Ask Pi (Enter to send, Shift+Enter for newline)': 'Спросить pi (Enter — отправить, Shift+Enter — новая строка)',
  'Ask Pi (Ctrl+Enter to send)': 'Спросить pi (Ctrl+Enter — отправить)',
  'Send': 'Отправить',
  'Attach file': 'Прикрепить файл',
  'Stop': 'Стоп',
  'thinking: {level}': 'мышление: {level}',
  'In: {in} · Out: {out}': 'Вход: {in} · Выход: {out}',
  'Read from cache: {read} ({hit}%)': 'Из кэша: {read} ({hit}%)',
  'Fresh: {in} · Written to cache: {write}': 'Свежие: {in} · Записано в кэш: {write}',

  // Тул-блоки
  'running…': 'выполняется…',
  'done': 'готово',

  // Диалоги расширений
  'answered': 'отвечено',
  'cancelled': 'отменено',
  'expired — pi applied the default answer': 'истёк — pi применил ответ по умолчанию',
  'pi asks': 'pi спрашивает',
  'Yes': 'Да',
  'No': 'Нет',
  'OK': 'OK',
  'Cancel': 'Отмена',

  // ask_question
  'expired': 'истёк',
  '— no answer': '— без ответа',
  '→ clarify in chat': '→ пояснить в чате',
  '{count} answered': 'отвечено: {count}',
  ' · {count} to chat': ' · в чат: {count}',
  'Submit': 'Отправить',
  'Recommended': 'Рекомендуется',
  'Why: {reason}': 'Почему: {reason}',
  'Own answer': 'Свой вариант',
  'Type your own answer…': 'Введите свой ответ…',
  'Needs clarification': 'Нужно пояснение',
  'Clarify in chat': 'Пояснить в чате',

  // Todo
  'Todo': 'Задачи',

  // Git-панель
  'Search branches': 'Поиск веток',
  'New branch...': 'Новая ветка...',
  'no branches': 'нет веток',
  'new branch from {name}': 'новая ветка от {name}',
  'new branch name': 'имя новой ветки',
  'Checkout': 'Checkout',
  'New Branch from {name}...': 'Новая ветка от {name}...',
  'Rename...': 'Переименовать...',
  'Delete': 'Удалить',
  'Rename {name}': 'Переименовать {name}',
  'Stage': 'Индексировать',
  'Unstage': 'Снять индекс',
  'Refresh': 'Обновить',
  'staged ({count})': 'проиндексировано ({count})',
  'changes ({count})': 'изменения ({count})',
  'nothing staged': 'индекс пуст',
  'working tree clean': 'рабочее дерево чисто',
  'Commit message…': 'Сообщение коммита…',
  'Generate commit message with pi': 'Сгенерировать сообщение коммита с pi',
  'Commit': 'Коммит',
  'Not a git repository': 'Не git-репозиторий',
  'Pick a session to see its git status': 'Выберите сессию, чтобы увидеть её git-статус',

  // Файлы
  'Refresh tree': 'Обновить дерево',
  'Pick a session to browse its files': 'Выберите сессию, чтобы смотреть файлы',
  'Close tab': 'Закрыть вкладку',
  'Close viewer (back to chat)': 'Закрыть просмотр (вернуться к чату)',
  'Soft wrap long lines': 'Мягкий перенос длинных строк',
  'wrap': 'перенос',

  // Дифф
  'Previous file': 'Предыдущий файл',
  'Next file': 'Следующий файл',
  'Unified diff': 'Единый дифф',
  'Side-by-side diff': 'Дифф в две колонки',
  'Close diff (back to chat)': 'Закрыть дифф (вернуться к чату)',
  'unified': 'единый',
  'split': 'две колонки',

  // Терминал
  'Pick a session to open a terminal': 'Выберите сессию, чтобы открыть терминал',
  'No terminals — press + or pick a profile': 'Нет терминалов — нажмите + или выберите профиль',
  'New terminal (default profile)': 'Новый терминал (профиль по умолчанию)',
  'Profile for new terminal': 'Профиль нового терминала',
  'Close terminal': 'Закрыть терминал',

  // Настройки — общие
  'saved': 'сохранено',
  'Close settings': 'Закрыть настройки',
  'Save': 'Сохранить',
  'General': 'Общие',
  'Appearance': 'Внешний вид',
  'Notifications': 'Уведомления',
  'Models': 'Модели',

  // Настройки — General
  'Chat': 'Чат',
  'send message with': 'отправка сообщения',
  'Enter (Shift+Enter — newline)': 'Enter (Shift+Enter — новая строка)',
  'interface language': 'язык интерфейса',
  'pi path': 'путь к pi',
  'Launch': 'Запуск',
  'extra pi args': 'доп. аргументы pi',
  'update feed URL': 'URL фида обновлений',
  'https://server/updates/ (empty = off)': 'https://server/updates/ (пусто = выкл)',
  'distro': 'дистрибутив',
  'auto (first distro)': 'авто (первый дистрибутив)',
  'auto (command -v pi)': 'авто (command -v pi)',

  // Настройки — Appearance
  'Chat toolbar': 'Панель чата',
  'model / thinking selectors and Stop button': 'селекты модели/thinking и кнопка Stop',
  'top — in the chat header': 'вверху — в шапке чата',
  'bottom — above the message input': 'внизу — над полем ввода',
  'Theme': 'Тема',
  'color theme': 'тема',
  'dark': 'тёмная',
  'light': 'светлая',
  'chat font size': 'размер шрифта чата',
  'Tool blocks': 'Тул-блоки',
  'single-line tool blocks (command in one line, full command and output when expanded)':
    'однострочные тул-блоки (команда в одну строку, в раскрытом — команда и вывод)',

  // Настройки — Notifications
  'Sounds': 'Звуки',
  'turn completed': 'ход завершён',
  'pi asks a question': 'pi задаёт вопрос',
  'empty = off (wav / aif / aiff / au)': 'пусто = выкл (wav / aif / aiff / au)',
  'Choose audio file': 'Выбрать аудиофайл',
  'bot token': 'токен бота',
  'token saved — type to replace': 'токен сохранён — введите новый',
  'asks permission (confirm)': 'запрашивает разрешение (confirm)',
  'needs an answer (question)': 'ждёт ответа (question)',
  'extension error': 'ошибка расширения',
  'Send test message': 'Отправить тестовое сообщение',
  'sent': 'отправлено',
  'Remote (phone browser)': 'Remote (браузер телефона)',
  'enable remote bridge (sessions are shared on the LAN)': 'включить remote-мост (сессии доступны в локальной сети)',
  'port': 'порт',
  'Bridge is off — enable it and reopen settings.': 'Мост выключен — включите и переоткройте настройки.',
  'port is free': 'порт свободен',
  'port is busy': 'порт занят',
  'Port {port} is busy — pick a free one in Settings → General': 'Порт {port} занят — выберите свободный в Настройках → Общие',

  // Настройки — Models
  'Open models.json in editor': 'Открыть models.json в редакторе',
  '(missing — will be created on save)': '(нет — будет создан при сохранении)',
  'context window': 'окно контекста',
  'max output tokens': 'макс. токенов вывода',
  'input:': 'вход:',
  'thinking levels:': 'уровни мышления:',
  'none': 'нет',
  'level': 'уровень',
  'API value (empty = null)': 'значение API (пусто = null)',
  'Remove level': 'Удалить уровень',
  '+ Add level': '+ Добавить уровень',
  'extra parameters (JSON)': 'доп. параметры (JSON)',
  'model id': 'id модели',
  'display name': 'отображаемое имя',
  'Collapse': 'Свернуть',
  'Expand': 'Развернуть',
  'Copy to another backend': 'Копировать на другой бэкенд',
  'Remove model': 'Удалить модель',
  'name': 'имя',
  'API key': 'API-ключ',
  'key or $ENV_VAR': 'ключ или $ENV_VAR',
  'base URL': 'base URL',
  'API protocol': 'API-протокол',
  'models': 'модели',
  '+ Add model': '+ Добавить модель',
  'Apply': 'Применить',
  'Copy model {id} to {backend}': 'Копировать модель {id} на {backend}',
  'create new provider': 'создать нового провайдера',
  'provider name': 'имя провайдера',
  'target provider': 'целевой провайдер',
  '— pick provider —': '— выберите провайдера —',
  'Copy': 'Копировать',
  'API key set': 'API-ключ задан',
  'API key is empty': 'API-ключ пуст',
  'Edit': 'Изменить',
  'Copy → {backend}': 'Копировать → {backend}',
  '{count} model(s)': 'моделей: {count}',
  '+ Add provider': '+ Добавить провайдера',
  'Finish or cancel the current edit first': 'Сначала завершите или отмените текущую правку',
  '(no base URL)': '(нет base URL)',
  '(no api)': '(нет api)',
  'Provider name is empty': 'Имя провайдера пустое',
  'Provider {name} already exists': 'Провайдер {name} уже существует',
  'Pick a provider or enter a new name': 'Выберите провайдера или введите новое имя',
  'Provider not found': 'Провайдер не найден',
  'Deleted {name}': 'Удалено: {name}',
  'Copied {name} to {backend}': 'Скопировано: {name} → {backend}',
  'Provider {name} already exists on {backend}. Overwrite?':
    'Провайдер {name} уже существует на {backend}. Перезаписать?',
  'Delete provider {name} from {backend} models.json?': 'Удалить провайдера {name} из models.json на {backend}?',
  'load failed': 'ошибка загрузки',
  'save failed': 'ошибка сохранения',
  'open failed': 'не удалось открыть',

  // MCP
  'Open file': 'Открыть файл',
  'Import JSON': 'Импорт JSON',
  '+ Add server': '+ Добавить сервер',
  'User — all projects': 'Пользователь — все проекты',
  'Project — .pi/mcp.json': 'Проект — .pi/mcp.json',
  '{file} (not created yet)': '{file} (ещё не создан)',
  'Import JSON with mcpServers': 'Импорт JSON с mcpServers',
  'Import': 'Импортировать',
  'Add MCP server': 'Добавить MCP-сервер',
  'Edit {name}': 'Изменить {name}',
  'latin letters, digits, - and _': 'латинские буквы, цифры, - и _',
  'transport': 'транспорт',
  'command': 'команда',
  'args (one per line)': 'args (по одному в строке)',
  'env (NAME=value, one per line)': 'env (ИМЯ=значение, по одному в строке)',
  'cwd (relative or ~/…)': 'cwd (относительный или ~/…)',
  'headers (Name=value, one per line)': 'headers (Имя=значение, по одному в строке)',
  'timeout, seconds': 'таймаут, секунды',
  'description': 'описание',
  'Save server': 'Сохранить сервер',
  'No MCP servers yet.': 'MCP-серверов пока нет.',
  'Check connection': 'Проверить соединение',
  'Check': 'Проверить',
  'Remove server': 'Удалить сервер',
  'connected · {count} tool(s)': 'подключено · инструментов: {count}',
  'error: {error}': 'ошибка: {error}',
  'Pick a session — MCP servers are per-project.': 'Выберите сессию — MCP-серверы настраиваются на проект.',
  'default — tools run through code mode': 'по умолчанию — инструменты через code mode',
  'loaded via tool search when the model needs them': 'загружаются через поиск инструментов по запросу модели',
  'declared up front like a built-in tool': 'объявлены заранее, как встроенный инструмент',
  'registered but not available to the model': 'зарегистрированы, но недоступны модели',
  'Name: latin letters, digits, - and _ only': 'Имя: только латинские буквы, цифры, - и _',
  'Command is required': 'Требуется команда',
  'URL is required': 'Требуется URL',
  'Invalid JSON': 'Некорректный JSON',
  'Expected an object with mcpServers': 'Ожидается объект с mcpServers',
  'No servers found in JSON': 'В JSON не найдено серверов',
  'applied to new chats; busy chats pick it up after a restart of the session.':
    'применяется к новым чатам; занятые чаты подхватят после перезапуска сессии.',

  // Навыки
  'Open user folder': 'Открыть папку юзера',
  'Open project folder': 'Открыть папку проекта',
  'User skills of the project backend (~/.pi/agent/skills) and project skills (.pi/skills, .agents/skills). Toggles write into the backend settings.json; new chats pick them up.':
    'Юзерские навыки бэкенда проекта (~/.pi/agent/skills) и проектные (.pi/skills, .agents/skills). Тогглы пишутся в settings.json бэкенда; новые чаты их подхватят.',
  'No skills found.': 'Навыки не найдены.',
  'Pick a session — skills are per-project.': 'Выберите сессию — навыки настраиваются на проект.',

  // Субагенты (транскрипт)
  'Back to parent session': '← назад к родителю',
  'Subagent sessions': 'Сессии субагентов',
  'Subagents': 'Субагенты',
  'Transcript failed to load': 'Не удалось загрузить транскрипт',

  // Worktree
  'New worktree': 'Новый worktree',
  'worktree name': 'имя worktree',
  'Remove worktree': 'Удалить worktree',
  "Remove worktree '{name}'?": "Удалить worktree «{name}»?",
  'There are uncommitted changes. Force remove?': 'Есть незакоммиченные изменения. Удалить принудительно?',
  'Invalid worktree name': 'Неверное имя worktree'
}

export type TFunc = (key: string, vars?: Record<string, string | number>) => string

function interpolate(text: string, vars?: Record<string, string | number>): string {
  if (vars === undefined) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match))
}

export function tFor(lang: UiLanguage): TFunc {
  if (lang !== 'ru') return (key, vars) => interpolate(key, vars)
  return (key, vars) => interpolate(RU[key] ?? key, vars)
}

export function useLang(): UiLanguage {
  return useSessionsStore((s) => s.settings?.language ?? 'en')
}

export function useT(): TFunc {
  const lang = useLang()
  return useMemo(() => tFor(lang), [lang])
}
