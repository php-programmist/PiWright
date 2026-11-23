/** Shiki-подсветка кода: ленивый синглтон-хайлайтер, неизвестный язык — plain.
 *  Тема передаётся вызовом (переключение темы — перерисовка блоков). */
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { Highlighter } from 'shiki'
import type { Theme } from '../../../shared/ipc-contracts'

const SHIKI_THEMES: Record<Theme, 'github-dark' | 'github-light'> = {
  dark: 'github-dark',
  light: 'github-light'
}

let highlighterPromise: Promise<Highlighter> | null = null

async function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-dark', 'github-light'],
        langs: [],
        engine: createJavaScriptRegexEngine({ forgiving: true })
      })
    )
  }
  return highlighterPromise
}

/** Готовый HTML подсветки; ошибка/неизвестный язык — null (рисуем plain). */
export async function highlightCode(code: string, language: string, theme: Theme): Promise<string | null> {
  try {
    const highlighter = await getHighlighter()
    await highlighter.loadLanguage(language as Parameters<Highlighter['loadLanguage']>[0])
    return highlighter.codeToHtml(code, {
      lang: language as Parameters<Highlighter['codeToHtml']>[1]['lang'],
      theme: SHIKI_THEMES[theme]
    })
  } catch (err) {
    console.warn('shiki highlight failed:', err)
    return null
  }
}
