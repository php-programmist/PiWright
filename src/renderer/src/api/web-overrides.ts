/** Веб-оверрайды API: нативные диалоги/открытия заменяются браузерной механикой —
 *  <input type=file> + upload по существующим каналам, Blob-download, window.open.
 *  Оборачивается только WS-транспорт (ensure-piwright); компоненты остаются транспорт-слепыми. */
import { base64FromBytes } from '../../../shared/attachments'
import type { AttachmentResult, GitOpResult, KanbanThemeImportResult, PiWrightApi } from '../../../shared/ipc-contracts'

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept.length > 0) input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function downloadText(name: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const cancelledAttachment: AttachmentResult = { ok: false, error: 'cancelled', name: '', isImage: false, ref: '', dataUrl: '' }
const cancelledThemes: KanbanThemeImportResult = { ok: false, error: 'cancelled', themes: [], imported: 0, skipped: 0 }

export function withWebOverrides(api: PiWrightApi): PiWrightApi {
  return {
    ...api,
    async chooseAttachment(project) {
      const file = await pickFile('')
      if (file === null) return cancelledAttachment
      return api.putAttachment(project, file.name, base64FromBytes(new Uint8Array(await file.arrayBuffer())))
    },
    async kanbanThemeImport() {
      const file = await pickFile('.json,application/json')
      if (file === null) return cancelledThemes
      return api.kanbanThemeImportData(await file.text())
    },
    async kanbanThemeExport(id) {
      const result = await api.kanbanThemeExportData(id)
      if (!result.ok) return { ok: false, error: result.error, path: '' }
      downloadText(result.name, result.json)
      return { ok: true, error: null, path: result.name }
    },
    async soundsChoose() {
      const file = await pickFile('.wav,.aif,.aiff,.au,audio/wav,audio/aiff,audio/basic')
      if (file === null) return { ok: false, error: null, path: '' }
      return api.soundsUpload(file.name, base64FromBytes(new Uint8Array(await file.arrayBuffer())))
    },
    async shellOpenExternal(url): Promise<GitOpResult> {
      if (typeof url !== 'string' || !/^(https?:\/\/|mailto:)/i.test(url.trim())) return { ok: false, error: 'Invalid url' }
      window.open(url.trim(), '_blank', 'noopener,noreferrer')
      return { ok: true, error: null }
    }
  }
}
