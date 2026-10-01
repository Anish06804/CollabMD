/** One-off cleanup: remove test versions contaminated by lock-test markers. */
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const bad = await prisma.documentVersion.findMany({
  where: { content: { contains: 'LOCKTEST-' } },
  select: { id: true, versionNumber: true },
})
console.log('contaminated versions:', bad.length, bad.map((v) => v.versionNumber))
if (bad.length > 0) {
  await prisma.documentVersion.deleteMany({ where: { id: { in: bad.map((v) => v.id) } } })
}

const doc = await prisma.document.findFirst({
  where: { room: { roomCode: 'CYNATE' } },
  select: { content: true, room: { select: { locked: true, name: true } } },
})
console.log('doc clean:', !doc.content.includes('LOCKTEST-'), '| room.locked:', doc.room.locked, '| doc chars:', doc.content.length)
await prisma.$disconnect()
