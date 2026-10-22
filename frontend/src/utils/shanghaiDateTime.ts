const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'

const shanghaiDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SHANGHAI_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export function formatShanghaiDateTime(value?: string | null): string {
  if (!value) return '—'

  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) return '—'

  const parts = Object.fromEntries(
    shanghaiDateTimeFormatter
      .formatToParts(timestamp)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}
