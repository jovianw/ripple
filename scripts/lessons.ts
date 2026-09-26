// Lesson review (Marcos): list lessons, retire bad ones, restore them. Retiring sets active=false, which
// retrieval already filters on (memory.retrieveLessons), so a retired lesson stops reaching the coder and critic
// but stays in Atlas with the reason. Nothing is deleted.
//   npm run lessons                          list every lesson
//   npm run lessons -- retire <id> "<why>"   stop using a lesson
//   npm run lessons -- restore <id>          use it again
const { client, col, connect } = await import(new URL("../apps/worker/src/db.ts", import.meta.url).href)
await connect()
const [cmd, id, ...why] = process.argv.slice(2)

if (cmd === "retire" || cmd === "restore") {
  if (!id) throw new Error(`usage: npm run lessons -- ${cmd} <id>${cmd === "retire" ? ' "<why>"' : ""}`)
  const update = cmd === "retire"
    ? { $set: { active: false, retired_reason: why.join(" ") || "retired in review", retired_at: new Date() } }
    : { $set: { active: true }, $unset: { retired_reason: "", retired_at: "" } }
  const r = await col.lessons.updateOne({ _id: id }, update)
  console.log(r.matchedCount ? `${cmd}d ${id}` : `no lesson ${id}`)
} else {
  const all = await col.lessons.find({}, { projection: { embedding: 0 } }).sort({ created_at: 1 }).toArray()
  for (const l of all) {
    console.log(`${l.active ? "active " : "RETIRED"} [${l._id}] helped ${l.times_helped ?? 0}x`)
    console.log(`  when: ${l.pattern}\n  do:   ${l.fix}${l.active ? "" : `\n  why retired: ${l.retired_reason}`}\n`)
  }
  console.log(`${all.filter((l: { active: boolean }) => l.active).length} active, ${all.filter((l: { active: boolean }) => !l.active).length} retired`)
}
await client.close()
