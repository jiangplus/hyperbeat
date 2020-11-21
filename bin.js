#!/usr/bin/env node

'use strict';

const HyperspaceClient = require('@hyperspace/client')
const hyperdrive = require('hyperdrive')
const Corestore = require('corestore')
const Networker = require('@corestore/networker')
const version = require('./package.json').version

const fs = require('fs')
const path = require('path')
const express = require('express')
const glob = require("glob")
const cli = require('cac')()

const serveStatic = require('./lib/serve-static')

cli.command('').action((options) => {
    console.log('cli tool to create and manage hyperdrive')
    console.log(cli.outputHelp())
  })

cli.command('init', 'init current dir as hyperdrive').action(async (files, options) => {
  if (fs.existsSync('dat.json')) {
    console.log('`dat.json` exists, dir already initialized')
    process.exit()
  }

  const client = new HyperspaceClient()
  const store = client.corestore()
  await store.ready()
  const drive = hyperdrive(store)

  drive.on('ready', async function () {
    console.log('key: ', drive.key.toString('hex'))
    console.log('discoverykey: ', drive.discoveryKey.toString('hex'))
    let data = {
      key: drive.key.toString('hex'),
      type: 'hyperdrive'
    }
    fs.writeFileSync('dat.json', JSON.stringify(data, null, 2))
    console.log('The current directory is initialized as a hyperdrive!')

    drive.close(() => {
      process.exit()
    })
  })
})

cli.command('add', 'add dir files to hyperdrive').action(async (files, options) => {
  if (!fs.existsSync('dat.json')) {
    console.log('`dat.json` not exists, please init dir with `hyperbeat init`')
    process.exit()
  }

  let datjson = fs.readFileSync('dat.json')
  let json = JSON.parse(datjson)
  let key = json.key

  const client = new HyperspaceClient()
  const store = client.corestore()
  await store.ready()
  const drive = hyperdrive(store, key)

  drive.on('ready', async function () {
    console.log('key: ', drive.key.toString('hex'))
    console.log('discoverykey: ', drive.discoveryKey.toString('hex'))

    glob("**/*", options, function (er, files) {
      console.log(files)

      let promises = files.map(file => {
        return new Promise( (resolve,reject) => {
          let dst = drive.createWriteStream(file)
          dst.on('finish', () => {
            resolve(null)
          })
          fs.createReadStream(file).pipe(dst)
        })
      })

      Promise.all(promises).then(() => {
        drive.close(() => {
          process.exit()
        })
      })
    })

  })
})

// cli.command('clone', 'init dir as hyperdrive').action(async (files, options) => {
//   console.log(files, options)
// })

// cli.command('info', 'init dir as hyperdrive').action(async (files, options) => {
//   console.log(files, options)
// })

cli.command('ls', 'init dir as hyperdrive')
  .option('--path <path>', 'path within the drive')
  .action(async (options) => {
  if (!fs.existsSync('dat.json')) {
    console.log('`dat.json` not exists, please init dir with `hyperbeat init`')
    process.exit()
  }

  if (!options.path) {
    console.log('--path <path> is required')
    process.exit()
  }

  let datjson = fs.readFileSync('dat.json')
  let json = JSON.parse(datjson)
  let key = json.key
  let path = options.path

  const client = new HyperspaceClient()
  const store = client.corestore()
  await store.ready()
  const drive = hyperdrive(store, key)

  drive.on('ready', async function () {
    console.log('key: ', drive.key.toString('hex'))
    console.log('discoverykey: ', drive.discoveryKey.toString('hex'))
    
    drive.readdir(path, 'utf-8', (err, data) => {
      console.log(data)

      drive.close(() => {
        process.exit()
      })
    })
  })
})

cli.command('cat', 'cat file content from hyperdrive')
  .option('--path <path>', 'file path within the drive')
  .action(async (options) => {
  if (!fs.existsSync('dat.json')) {
    console.log('`dat.json` not exists, please init dir with `hyperbeat init`')
    process.exit()
  }

  if (!options.path) {
    console.log('--path <path> is required')
    process.exit()
  }

  let datjson = fs.readFileSync('dat.json')
  let json = JSON.parse(datjson)
  let key = json.key
  let path = options.path

  const client = new HyperspaceClient()
  const store = client.corestore()
  await store.ready()
  const drive = hyperdrive(store, key)

  drive.on('ready', async function () {
    drive.readFile(path, 'utf-8', (err, data) => {
      console.log(data)

      drive.close(() => {
        process.exit()
      })
    })
  })
})

cli.command('pin', 'pin hyperdrive to local hyperspace')
  .option('--key <key>', 'hyperdrive key')
  .action(async (options) => {
  let key = options.key

  if (!options.key) {
    console.log('--key <key> is required')
    process.exit()
  }

  const client = new HyperspaceClient()
  const store = client.corestore()
  await store.ready()
  const networker = new Networker(store)
  const drive = hyperdrive(store, key)

  drive.on('ready', async function () {
    console.log('key: ', drive.key.toString('hex'))
    console.log('discoverykey: ', drive.discoveryKey.toString('hex'))

    await networker.configure(drive.discoveryKey, { announce: true, lookup: true })
    await drive.download('/')
    drive.close(() => {
      process.exit()
    })
  })
})

cli.command('share', 'share hyperdrive and serve as http')
  .option('--port <port>', 'http port, default to 3030')
  .option('--key <key>', 'hyperdrive key for the drive to share, use local dat.json if <key> is not provided')
  .action(async (options) => {
  let key = options.key
  let port = options.port || 3030

  if (!key) {
    try {
      let datjson = fs.readFileSync('dat.json')
      let json = JSON.parse(datjson)
      key = json.key
    } catch(err) {
        console.log('cannot read dat.json or retrive --key <key>')
        process.exit()
    }
  }

  const client = new HyperspaceClient()
  const store = client.corestore()
  await store.ready()
  const networker = new Networker(store)
  const drive = hyperdrive(store, key)

  drive.on('ready', async function () {
    console.log('key: ', drive.key.toString('hex'))
    console.log('discoverykey: ', drive.discoveryKey.toString('hex'))

    const app = express()

    app.use(serveStatic(path.join(__dirname, 'public')))
    app.use(serveStatic('/', {fs: drive}))
    app.listen(port, () => {
      console.log(`listening... please open http://localhost:${port} in the browser`)
    })

    await networker.configure(drive.discoveryKey, { announce: true, lookup: true })
  })
})

cli.version(version)

cli.help()

cli.parse()
