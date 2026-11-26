/** Шина событий main → клиенты: замена прямых webContents.send. Sink'и — провода транспортов
 *  (окно Electron, WS-клиенты веб-режима). Payload — один аргумент или ни одного (как send). */
export type EventSink = (channel: string, ...values: unknown[]) => void

export class EventBroadcaster {
  private readonly sinks = new Set<EventSink>()

  addSink(sink: EventSink): () => void {
    this.sinks.add(sink)
    return () => {
      this.sinks.delete(sink)
    }
  }

  emit(channel: string, ...values: unknown[]): void {
    for (const sink of this.sinks) sink(channel, ...values)
  }
}
