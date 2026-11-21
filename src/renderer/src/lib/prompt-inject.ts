/** Мост «вставить текст в поле ввода чата» из любой панели (файловое меню → @-ссылка). */
type Listener = (text: string) => void

const listeners = new Set<Listener>()

export function onPromptInject(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function injectIntoPrompt(text: string): void {
  for (const listener of listeners) listener(text)
}
