// Reusable skeleton loading placeholders — use instead of bare spinners.
//   <Skeleton.PageHeader /> <Skeleton.StatCards count={5} /> <Skeleton.Table rows={6} cols={5} />
//   <Skeleton.Card /> <Skeleton.Line w="w-32" /> <Skeleton.Block h="h-40" /> <Skeleton.KanbanBoard />
// Grid counts use a static map so Tailwind's JIT keeps the classes.

const base = 'skeleton-shimmer rounded'
const GRID = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }
const COLS = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4', 5: 'grid-cols-5', 6: 'grid-cols-6' }

function Line({ w = 'w-full', h = 'h-3', className = '' }) { return <div className={`${base} ${w} ${h} ${className}`} /> }
function Block({ w = 'w-full', h = 'h-32', className = '' }) { return <div className={`${base} ${w} ${h} rounded-xl ${className}`} /> }
function Circle({ size = 'w-10 h-10' }) { return <div className={`${base} ${size} rounded-full`} /> }

function Card() {
  return (
    <div className="card px-5 py-4 space-y-2">
      <Line w="w-20" h="h-2" /><Line w="w-16" h="h-6" /><Line w="w-12" h="h-2" />
    </div>
  )
}

function TableRow({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3.5"><Line w={i === 0 ? 'w-16' : i === 1 ? 'w-32' : 'w-20'} h="h-3" /></td>
      ))}
    </tr>
  )
}

function Table({ rows = 6, cols = 5 }) {
  return (
    <div>
      <div className="flex gap-6 px-4 py-3 border-b border-divider">
        {Array.from({ length: cols }).map((_, i) => <Line key={i} w="w-16" h="h-2" />)}
      </div>
      <table className="w-full"><tbody className="divide-y divide-divider">
        {Array.from({ length: rows }).map((_, i) => <TableRow key={i} cols={cols} />)}
      </tbody></table>
    </div>
  )
}

function PageHeader() {
  return <div className="space-y-2"><Line w="w-48" h="h-7" /><Line w="w-64" h="h-3" /></div>
}

function StatCards({ count = 4 }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 ${GRID[count] || GRID[4]} gap-4`}>
      {Array.from({ length: count }).map((_, i) => <Card key={i} />)}
    </div>
  )
}

function TaskList({ count = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-divider">
          <div className={`${base} w-5 h-5 rounded-full`} />
          <div className="flex-1 space-y-1.5"><Line w={i % 2 === 0 ? 'w-3/4' : 'w-1/2'} h="h-3" /><Line w="w-20" h="h-2" /></div>
          <Line w="w-16" h="h-3" />
        </div>
      ))}
    </div>
  )
}

function KanbanBoard({ cols = 6, cards = 2 }) {
  return (
    <div className={`grid ${COLS[cols] || COLS[6]} gap-3`}>
      {Array.from({ length: cols }).map((_, ci) => (
        <div key={ci} className="rounded-xl border border-rule bg-card p-3 min-h-[16rem]">
          <div className="flex items-center gap-2 mb-3 pb-2 border-b border-divider"><div className={`${base} w-2 h-2 rounded-full`} /><Line w="w-16" h="h-3" /></div>
          <div className="space-y-2">
            {Array.from({ length: ci < 2 ? cards : 0 }).map((_, ri) => (
              <div key={ri} className="p-2.5 rounded-lg border border-divider space-y-2"><Line w="w-full" h="h-3" /><Line w="w-16" h="h-2" /></div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Composite for the artist profile: avatar + identity block, the stat strip,
// then the tabbed body. A page whose whole layout arrives at once shouldn't
// announce itself with one line of grey text.
function ArtistProfile() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Circle size="w-16 h-16" />
        <div className="flex-1 space-y-2">
          <Line w="w-48" h="h-5" />
          <Line w="w-32" h="h-3" />
        </div>
        <Line w="w-24" h="h-8" />
      </div>
      <StatCards count={4} />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => <Line key={i} w="w-20" h="h-7" />)}
      </div>
      <div className="card px-5 py-4 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => <Line key={i} w={i % 2 ? 'w-2/3' : 'w-full'} h="h-3" />)}
      </div>
    </div>
  )
}

const Skeleton = { Line, Block, Circle, Card, Table, TableRow, PageHeader, StatCards, TaskList, KanbanBoard, ArtistProfile }
export default Skeleton
