/** Shiki-подсветка кода: ленивый синглтон-хайлайтер, неизвестный язык — plain. */
import type { Highlighter } from 'shiki'

let highlighterPromise: Promise<Highlighter> | null = null

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({ themes: ['github-dark'], langs: [] })
    )
  }
  return highlighterPromise
}

/** Готовый HTML подсветки; ошибка/неизвестный язык — null (рисуем plain). */
export async function highlightCode(code: string, language: string): Promise<string | null> {
  try {
    const highlighter = await getHighlighter()
    await highlighter.loadLanguage(language as Parameters<Highlighter['loadLanguage']>[0])
    return highlighter.codeToHtml(code, { lang: language as Parameters<Highlighter['codeToHtml']>[1]['lang'], theme: 'github-dark' })
  } catch {
    return null
  }
}
