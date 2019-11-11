const electron = require('electron')
const log = require('electron-log')
const { hash } = require('eth-ens-namehash')
const crypto = require('crypto')

const cheerio = require('cheerio')

const store = require('../store')
const ipfs = require('../clients/Ipfs')
const windows = require('../windows')

const server = require('./server')

const mock = {
  ens: {
    resolveContent: (domain) => {
      return { type: 'ipfs', hash: 'QmXSBLw6VMegqkCHSDBPg7xzfLhUyuRBzTb927KVzKC1vq' }
    }
  },
  shell: {
    openExternal: (url) => {
      require('child_process').exec(`xdg-open "${url}"`)
    }
  }
}

const ens = electron.app ? require('../ens') : mock.ens
const shell = electron.shell ? electron.shell : mock.shell

class Dapps {
  constructor () {
    // setInterval(() => {
    //   this._updateHashes()
    // }, 60000)
    // setInterval(() => {
    //   this._updatePins()
    // }, 15000)
    ipfs.on('state', state => {
      if (state === 'ready') this._updatePins()
    })
  }

  async add (domain, cb) {
    // Resolve ENS name
    const namehash = hash(domain)

    // Check if already added
    if (store(`main.dapps.${namehash}`)) {
      console.log(store(`main.dapps.${namehash}`))
      // store.removeDapp(namehash)
      // store.addDapp()
      // store.addDapp(namehash, { domain, type, hash, pinned: false })
      return cb(new Error('Dapp already added'))
    }

    // Resolve content
    const content = await ens.resolveContent(domain)

    // If content available -> store dapp
    if (content) {
      const { type, hash } = content
      store.addDapp(namehash, { domain, type, hash, pinned: false })
      // Get Dapp Icon
      ipfs.api.get(`${hash}/index.html`, (err, files) => {
        if (err) log.error(new Error('Could not resolve dapp: ' + err.message))
        const $ = cheerio.load(files[0].content.toString('utf8'))
        let favicon = ''
        $('link').each((i, link) => {
          if ($(link).attr('rel') === 'icon' || $(link).attr('rel') === 'shortcut icon') {
            favicon = favicon || $(link).attr('href')
          }
        })
        if (favicon.startsWith('./')) favicon = favicon.substring(2)
        store.updateDapp(namehash, { icon: favicon || 'favicon.ico' })
      })
      this._pin(hash, () => {
        console.log('Pinned first time')
        store.updateDapp(namehash, { pinned: true })
      })
      cb(null)
    // Else -> throw
    } else {
      cb(new Error('Could not resolve ENS name to content hash'))
    }
  }

  remove (domain, cb) {
    const namehash = hash(domain)

    // Check if exists
    if (!store(`main.dapps.${namehash}`)) return cb(new Error('Dapp doesn\'t exist'))

    // Remove dapp
    store.removeDapp(namehash)
    cb(null)
  }

  move (fromArea, fromIndex, toArea, toIndex, cb) {
    store.moveDapp(fromArea, fromIndex, toArea, toIndex)
    cb(null)
  }

  async launch (domain, cb) {
    const dapp = store(`main.dapps.${hash(domain)}`)
    if (!dapp) return cb(new Error('Could not find dapp'))
    // if (!dapp.pinned) return cb(new Error('Dapp not pinned'))
    if (!ipfs.api) return cb(new Error('IPFS client not running'))
    const session = crypto.randomBytes(6).toString('hex')
    server.sessions.add(domain, session)
    windows.openView(domain, session)
    // shell.openExternal(`http://localhost:8421/?dapp=${domain}:${session}`)
    cb(null)
  }

  async _pin (hash, cb) {
    if (!ipfs.api) return cb(new Error('IPFS client not running'))
    ipfs.api.pin.add(hash, (err, res) => {
      if (err) return cb(new Error(`Failed to pin content with hash ${hash}`))
      cb(null)
    })
  }

  _updateHashes () {
    // For each registered dapp ->
    Object.entries(store('main.dapps')).forEach(async ([namehash, dapp]) => {
      // 1) resolve content
      const result = await ens.resolveContent(dapp.domain)
      // 2) if new content hash -> update dapp and pin content
      if (result && result.hash !== dapp.hash) {
        store.updateDapp(namehash, { hash: result.hash, pinned: false })
        this._pin(result.hash, (err) => {
          if (err) return log.error(err)
          store.updateDapp(namehash, { pinned: true })
        })
      }
    })
  }

  _updatePins () {
    Object.entries(store('main.dapps')).forEach(async ([namehash, dapp]) => {
      const ipfsState = store('main.clients.ipfs.state')
      if (ipfsState === 'ready' && !dapp.pinned) {
        console.log('Pinning', dapp.domain)
        this._pin(dapp.hash, (err) => {
          if (err) return log.error(err)
          store.updateDapp(namehash, { pinned: true })
        })
      }
    })
  }
}

const dapps = new Dapps()
module.exports = dapps

// DEBUG
store.observer(_ => {
  console.log(store('main.dapps'))
})

// setInterval(async () => {
//   console.log('peers', (await ipfs.api.swarm.peers()).length)
// }, 3000)
