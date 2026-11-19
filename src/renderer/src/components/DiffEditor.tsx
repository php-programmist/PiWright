/** Monaco DiffEditor (read-only): original = HEAD-версия, modified = файл на диске.
 *  Язык определяется Monaco по расширению в uri модели. */
import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'

interface DiffEditorProps {
  path: string
  original: string
  modified: string
  sideBySide: boolean
}

export function DiffEditor({ path, original, modified, sideBySide }: DiffEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IDiffEditor | null>(null)

  useEffect(() => {
    const editor = monaco.editor.createDiffEditor(containerRef.current!, {
      readOnly: true,
      theme: 'vs-dark',
      automaticLayout: true,
      renderSideBySide: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 12.5
    })
    editorRef.current = editor
    return () => {
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  useEffect(() => {
    const editor = editorRef.current
    if (editor === null) return
    const safePath = path.replace(/^[/\\]+/, '')
    const originalModel = monaco.editor.createModel(
      original,
      undefined,
      monaco.Uri.parse(`inmemory://git/original/${safePath}`)
    )
    const modifiedModel = monaco.editor.createModel(
      modified,
      undefined,
      monaco.Uri.parse(`inmemory://git/modified/${safePath}`)
    )
    editor.setModel({ original: originalModel, modified: modifiedModel })
    return () => {
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [original, modified, path])

  return <div ref={containerRef} className="diff-editor" />
}
