#!/usr/bin/env electron

var electron = require('electron')
var path = require('path')
var os = require('os')
var fs = require('fs')

var argv = require('minimist')(process.argv.slice(2))

var shellPath = path.join(os.tmpdir(), 'electricorder.html')

if (argv._.length !== 1) {
  console.error('must specify path for movie to record')
  process.exit()
}

var frameCount = (argv.frames || 1000) | 0
var frameWidth = (argv.width || argv.w || 256) | 0
var frameHeight = (argv.height || argv.h || 256) | 0
var recorderOptions = {
  fps: +argv.fps || 60,
  format: argv.format,
  ffmpeg: argv.ffmpeg,
  output: argv.o
}
var progPath = path.join(process.cwd(), argv._[0])

var shellFile = `
<html>
  <body>
    <script>
      (function () {
        console.log('start!')
        var electron = require('electron')
        var createVideoRecorder = require('electron-recorder')
        var win = electron.remote.getCurrentWindow()
        var video = createVideoRecorder(win, ${JSON.stringify(recorderOptions)})

        var frameCount = ${frameCount}
        var frameReady = true
        var pending = null

        function rafShim (cb) {
          function handleRAF () {
            if (--frameCount > 0) {
              video.frame(function () {
                try {
                  cb()
                } catch (e) {}
                if (pending) {
                  pending()
                } else {
                  frameReady = true
                }
              })
            } else {
              // Otherwise, movie is over and we save the snapshot to file
              video.end()
              win.close()
            }
          }
          if (frameReady) {
            return setTimeout(handleRAF)
          } else {
            pending = handleRAF
          }
        }

        requestAnimationFrame = window.requestAnimationFrame = rafShim
        cancelAnimationFrame = window.cancelAnimationFrame = function (x) {
          clearTimeout(x)
          pending = null
        }
      })();
      require("${progPath}");
    </script>
  </body>
</html>
`

fs.writeFileSync(shellPath, shellFile)

electron.app.on('ready', function () {
  var win = new electron.BrowserWindow()
  win.setSize(frameWidth, frameHeight)
  win.loadURL('file://' + shellPath)
  var reading = false
  electron.ipcMain.on('stdin.read', onread)
  process.stdin.on('readable', function () {
    if (reading) onread()
  })
  process.stdin.on('end', function () {
    win.webContents.send('stdin.data', null)
  })
  function onread () {
    var buf = process.stdin.read()
    reading = false
    if (buf) win.webContents.send('stdin.data', buf)
    else reading = true
  }
})