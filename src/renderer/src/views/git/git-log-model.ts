/** Модель графа веток для дока Git Log: раскладка коммитов по дорожкам (lanes)
 *  и форматирование дат. Чистые функции — покрываются юнит-тестами. */

export interface LaneInput {
  hash: string
  parents: string[]
}

export interface LaneRow {
  /** Дорожка, на которой стоит точка коммита. */
  lane: number
  /** Состояние дорожек ПОСЛЕ строки: hash, который ждём в дорожке, либо null (свободна). */
  nextLanes: (string | null)[]
  /** Кривые из точки коммита к дорожкам родителей: индексы дорожек в nextLanes. */
  edges: number[]
}

/** Раскладка дорожек: идём от новых к старым, точка коммита — в дорожке, где ждут его hash
 *  (иначе первая свободная/новая). Первая дорожка после строки — первый родитель, остальные
 *  родители — существующая дорожка с их hash или новая дорожка (ветвление). */
export function computeLanes(entries: LaneInput[]): LaneRow[] {
  const rows: LaneRow[] = []
  let lanes: (string | null)[] = []
  for (const entry of entries) {
    let lane = lanes.indexOf(entry.hash)
    if (lane < 0) {
      lane = lanes.findIndex((x) => x === null)
      if (lane < 0) {
        lane = lanes.length
        lanes.push(null)
      }
    }
    const nextLanes = [...lanes]
    const edges: number[] = []
    if (entry.parents.length > 0) {
      // Первый родитель наследует дорожку коммита, остальные — существующая дорожка с их hash или новая.
      nextLanes[lane] = entry.parents[0]!
      edges.push(lane)
      for (const parent of entry.parents.slice(1)) {
        let target = nextLanes.indexOf(parent)
        if (target < 0) {
          target = nextLanes.findIndex((x) => x === null)
          if (target < 0) {
            target = nextLanes.length
            nextLanes.push(null)
          }
        }
        nextLanes[target] = parent
        edges.push(target)
      }
    } else {
      nextLanes[lane] = null
    }
    lanes = nextLanes
    rows.push({ lane, nextLanes, edges })
  }
  return rows
}

const LANE_COLORS = [
  '#4f8ccb',
  '#4caf6e',
  '#c9a227',
  '#c96f27',
  '#b0568f',
  '#5fb3b3',
  '#8f7fd4',
  '#c95f5f'
]

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]!
}

const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Дата коммита в стиле PHPStorm: «только что», «N минут назад», «Сегодня HH:MM»,
 *  «Вчера HH:MM», «D мес HH:MM» (текущий год) или «YYYY-MM-DD». */
export function formatGitDate(unixSeconds: number, lang: 'ru' | 'en', now = new Date()): string {
  const date = new Date(unixSeconds * 1000)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return lang === 'ru' ? 'только что' : 'just now'
  if (diffMin < 60) {
    if (lang === 'ru') {
      const mod10 = diffMin % 10
      const mod100 = diffMin % 100
      const word = mod10 === 1 && mod100 !== 11 ? 'минуту' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'минуты' : 'минут'
      return `${diffMin} ${word} назад`
    }
    return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  }
  const hhmm = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000)
  if (dayDiff === 0) return lang === 'ru' ? `Сегодня ${hhmm}` : `Today ${hhmm}`
  if (dayDiff === 1) return lang === 'ru' ? `Вчера ${hhmm}` : `Yesterday ${hhmm}`
  const months = lang === 'ru' ? RU_MONTHS : EN_MONTHS
  const dayMonth = `${date.getDate()} ${months[date.getMonth()]}`
  if (date.getFullYear() === now.getFullYear()) return `${dayMonth}, ${hhmm}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
