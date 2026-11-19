/** Monaco read-only просмотр файла: язык определяется Monaco по расширению в uri модели. */
import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'

interface FileEditorProps {
  path: string
  content: string
}

export function FileEditor({ path, content }: FileEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<monaco.editor.ITextModel | null>(null)

  useEffect(() => {
    const editor = monaco.editor.create(containerRef.current!, {
      readOnly: true,
      theme: 'vs-dark',
      automaticLayout: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      fontSize: 12.5
    })
    editorRef.current = editor
    return () => {
      editor.dispose()
      editorRef.current = null
      modelRef.current?.dispose()
      modelRef.current = null
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    if (editor === null) return
    const safePath = path.replace(/^[/\\]+/, '')
    const uri = monaco.Uri.parse(`inmemory://file/${safePath}`)
    if (modelRef.current?.uri.toString() !== uri.toString()) {
      modelRef.current?.dispose()
      const model = monaco.editor.createModel(content, undefined, uri)
      modelRef.current = model
      editor.setModel(model)
    } else if (modelRef.current.getValue() !== content) {
      modelRef.current.setValue(content)
    }
  }, [path, content])

  return <div ref={containerRef} className="file-editor" />
}
