#!/usr/bin/env electron

var electron = require('electron')
var path = require('path')
var os = require('os')
var fs = require('fs')

var argv = require('minimist')(process.argv.slice(2))

var shellPath = path.join(os.tmpdir(), 'electricorder.html')

function printArgs () {
  console.log(`
electricorder arguments:
    -fps          frame rate of video
    -ffmpeg       path to ffmpeg
    -width, -w    video width
    -height, -h   video height
    -time         video duration in seconds
    -frames       number of frames
    -format       ffmpeg format
    -o            output file (if unspecified redirects to stdout)
`)
}

if (argv._.length !== 1) {
  printArgs()
  electron.app.quit()
}

var fps = +argv.fps || 60

var frameCount = 1000
if ('time' in argv) {
  frameCount = Math.ceil(argv.time * fps)
} else if ('frames' in argv) {
  frameCount = argv.frames
}

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
        var electron = require('electron')
        var spawn = require('child_process').spawn

        function createVideoRecorder (win, options_) {
          var options = options_ || {}

          if (!win) {
            throw new Error('electron-animator: you must specify a BrowserWindow')
          }

          var ffmpegPath = options.ffmpeg || 'ffmpeg'
          var fps = options.fps || 60

          var args = [
            '-y',
            '-f', 'image2pipe',
            '-r', '' + (+fps),
            // we use jpeg here because the most common version of ffmpeg (the one
            // that ships with homebrew) is broken and crashes when you feed it PNG data
            //  https://trac.ffmpeg.org/ticket/1272
            '-vcodec', 'mjpeg',
            '-i', '-'
          ]

          var outFile = options.output

          if ('format' in options) {
            args.push('-f', options.format)
          } else if (!outFile) {
            args.push('-f', 'matroska')
          }

          if (outFile) {
            args.push(outFile)
          } else {
            args.push('-')
          }

          var ffmpeg = spawn(ffmpegPath, args)

          function appendFrame (next) {
            // This is dumb, but sometimes electron's capture fails silently and returns
            // an empty buffer instead of an image.  When this happens we can retry and
            // usually it works the second time.
            function tryCapture () {
              try {
                win.capturePage(function (image) {
                  var jpeg = image.toJpeg(100)
                  if (jpeg.length === 0) {
                    setTimeout(tryCapture, 10)
                  } else {
                    ffmpeg.stdin.write(jpeg, function (err) {
                      next(err)
                    })
                  }
                })
              } catch (err) {
                next(err)
              }
            }
            tryCapture()
          }

          function endMovie () {
            ffmpeg.stdin.end()
          }

          var result = {
            frame: appendFrame,
            end: endMovie,
            log: ffmpeg.stderr
          }

          if (!outFile) {
            result.stream = ffmpeg.stdout
          }

          return result
        }

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
