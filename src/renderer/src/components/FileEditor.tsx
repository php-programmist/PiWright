/** Monaco-редактор файла: правки автосохраняются (debounce 500 мс), Ctrl+S — сразу;
 *  внешние изменения (watcher) перезатирают модель без обратной записи. */
import { useCallback, useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import type { ProjectEntry } from '../../../shared/ipc-contracts'
import { useFilesStore } from '../stores/files'

interface FileEditorProps {
  project: ProjectEntry
  path: string
  content: string
  wordWrap: boolean
}

export function FileEditor({ project, path, content, wordWrap }: FileEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)
  const saveContent = useFilesStore((s) => s.saveContent)
  const pendingRef = useRef<{ project: ProjectEntry; path: string; value: string } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applyingRef = useRef(false)
  const targetRef = useRef({ project, path })
  const flushRef = useRef<() => void>(() => {})

  useEffect(() => {
    targetRef.current = { project, path }
  }, [project, path])

  const flush = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending === null) return
    void saveContent(pending.project, pending.path, pending.value)
  }, [saveContent])

  useEffect(() => {
    flushRef.current = flush
  }, [flush])

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current!, {
      theme: 'vs-dark',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 12.5
    })
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => flushRef.current())
    const disposable = editor.onDidChangeModelContent(() => {
      if (applyingRef.current) return
      const value = editor.getModel()?.getValue()
      if (value === undefined) return
      pendingRef.current = { project: targetRef.current.project, path: targetRef.current.path, value }
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => flushRef.current(), 500)
    })
    return () => {
      disposable.dispose()
      flushRef.current()
      editor.dispose()
      editorRef.current = null
      modelRef.current?.dispose()
      modelRef.current = null
    }
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ wordWrap: wordWrap ? 'on' : 'off' })
  }, [wordWrap])

  useEffect(() => {
    const editor = editorRef.current
    if (editor === null) return
    const safePath = path.replace(/^[/\\]+/, '')
    const uri = monaco.Uri.parse(`inmemory://file/${safePath}`)
    if (modelRef.current?.uri.toString() !== uri.toString()) {
      flushRef.current()
      modelRef.current?.dispose()
      const model = monaco.editor.createModel(content, undefined, uri)
      modelRef.current = model
      editor.setModel(model)
    } else if (modelRef.current.getValue() !== content) {
      applyingRef.current = true
      modelRef.current.setValue(content)
      applyingRef.current = false
    }
  }, [path, content])

  return <div ref={containerRef} className="file-editor" />
}
