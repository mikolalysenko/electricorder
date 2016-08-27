const regl = require('regl')()

regl.frame(() => {
  regl.clear({
    color: [Math.random(), Math.random(), Math.random(), 1]
  })
})
