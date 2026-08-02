// Cross-platform fake CLI for provider spawn tests (node echo-args | ok | fail).
const mode = process.argv[2] || 'echo-args'
const rest = process.argv.slice(3)
if (mode === 'ok') {
  console.log('ok')
  process.exit(0)
}
if (mode === 'hello') {
  console.log('hello from runner')
  process.exit(0)
}
if (mode === 'fail') {
  console.error('boom')
  process.exit(1)
}
if (mode === 'echo-args') {
  for (const a of rest) console.log(a)
  process.exit(0)
}
process.exit(2)
