/** Two-line tab label: Chinese primary, compact English secondary. */
export default function BiLabel({ zh, en }: { zh: string; en: string }) {
  return (
    <span className="tn-bi-label">
      <span className="tn-bi-label-zh">{zh}</span>
      <span className="tn-bi-label-en">{en}</span>
    </span>
  )
}
