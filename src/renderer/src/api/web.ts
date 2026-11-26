/** Флаги веб-режима: рендерер работает в браузере (WS-транспорт), а не под preload.
 *  Маркер __piwrightWeb ставится в ensure-piwright до динамического импорта App — все модули
 *  рендерера вычисляются уже после выбора транспорта. */

declare global {
  interface Window {
    __piwrightWeb?: boolean
  }
}

export const isWeb: boolean = window.__piwrightWeb === true

/** Файловый менеджер на машине пользователя: десктоп — всегда, веб — только когда браузер
 *  на той же машине, что файлы (localhost). */
export const canReveal: boolean = !isWeb || isLocalHost()

export function isLocalHost(): boolean {
  const host = location.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}
