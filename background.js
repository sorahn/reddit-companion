redditInfo = {
  getURL: function(url) {
    return this.url[url]
  },
  
  setURL: function(url, info) {
    this.url[url] = info
    this.fullname[info.name] = info
  },

  checkMail: function(params, callback) {
    if (!redditInfo.isLoggedIn()) { return }
    console.log('Checking reddit mail..')
    $.ajax({
      url: 'http://www.reddit.com/message/unread/.json',
      success: function(resp) {
        if (resp.data) {
          var newMsgCount = 0
          var newIdx = null

          for (i = 0; i < resp.data.children.length; i++) {
            var messageTime = resp.data.children[i].data.created_utc*1000
            if (!!redditInfo.lastMailCheckTime || messageTime > redditInfo.lastMailCheckTime) {
              newMsgCount++
              if (!newIdx) { newIdx = i }
            }
          }
          

          var notifyTitle, notifyText
          if (newMsgCount == 1) {
            notifyTitle = resp.data.children[newIdx].data.author + ': ' +
              resp.data.children[newIdx].data.subject
            notifyText = resp.data.children[newIdx].data.body
          } else if (newMsgCount > 1) {
            notifyTitle = 'reddit: new messages!'
            notifyText = 'You have ' + resp.data.children.length + ' new messages.'
          }
          
          console.log('New messages: ', newMsgCount)

          if (newMsgCount > 0) {
            var n = webkitNotifications.createNotification(
              'images/reddit_mail_icon.svg',
              notifyTitle,
              notifyText)
            n.onclick = function() { window.open('http://www.reddit.com/message/unread/') }
            n.show()
          }

          redditInfo.lastMailCheckTime = new Date()
        }
      },
      error: function() {
          console.log('Reddit mail check failed!')
      }
    })
  },

  _queryInfo: function(params, callback) {
    console.log('Performing AJAX info call for ', params)
    params.limit = 1
    $.ajax({
      url: 'http://www.reddit.com/api/info.json',
      data: params,
      success: function(resp) {
        if (resp.data) {
          redditInfo.modhash = resp.data.modhash
          if (!resp.data.children.length) {
            var info = resp.data.children[0].data
            redditInfo.setURL(info.url, info)
            tabStatus.updateOverlay(info)
          }
          if (callback) { callback(info) }
        }
      },
      error: function() {
        if (callback) { callback(null) }
      }
    })
  },

  lookupURL: function(url, callback) {
    this._queryInfo({url:url}, callback)
  },


  lookupName: function(name, callback) {
    this._queryInfo({id:name}, callback)
  },

  _storedLookup: function(key, array, lookup, callback) {
    var stored = array[key]
    if (stored) {
      // Return our stored data right away, refreshing in the background.
      callback(stored)
      lookup(key)
    } else {
      lookup(key, callback)
    }
  },

  lookupURLStored: function(url, callback) {
    this._storedLookup(url, this.url, $.proxy(this.lookupURL, this), callback)
  },

  lookupNameStored: function(name, callback) {
    this._storedLookup(name, this.fullname, $.proxy(this.lookupName, this), callback)
  },

  _thingAction: function(action, data, callback) {
    if (!this.isLoggedIn()) {
      this.lookupName(data.id, function() {
        // Retry after we've stashed a modhash.
        redditInfo._thingAction(action, data, callback)
      })
      return
    }

    data.uh = this.modhash
    $.ajax({
      type: 'POST',
      url: 'http://www.reddit.com/api/'+action,
      data: data,
      success: function(resp) { callback(true) },
      error: function() { callback(false) }
    })
  },

  vote: function(fullname, likes, callback) {
    var dir
    if (likes == true) {
      dir = 1
    } else if (likes == false) {
      dir = -1
    } else {
      dir = 0
    }
    
    this._thingAction('vote', {id:fullname, dir:dir}, callback)
  },

  save: function(fullname, callback) {
    this._thingAction('save', {id:fullname}, callback)
  },

  unsave: function(fullname, callback) {
    this._thingAction('unsave', {id:fullname}, callback)
  },
  
  isLoggedIn: function() {
    // TODO: check for cookie
    return this.modhash != null && this.modhash != ""
  },

  init: function() {
    this.modhash = localStorage['modhash']
  },
    
  storeModhash: function(modhash) {
    localStorage['modhash'] = this.modhash = modhash
  },

  url: {}, 
  fullname: {},
  lastMailCheckTime: null,
}

tabStatus = {
  set: function(tabId, fullname) {
    if (fullname) {
      this.tabId[tabId] = fullname
      
      if (!this.fullname[fullname]) {
        this.fullname[fullname] = []
      }
      this.fullname[fullname].push(tabId)
    } else {
      this.tabId[tabId] = true
    }
  },
  
  remove: function(tabId) {
    var fullname = this.tabId[tabId]
    delete this.tabId[tabId]
    if (fullname && fullname !== true) {
      this.fullname[fullname].filter(function(x) {return x != tabId})
      if (!this.fullname[fullname]) {
        delete this.fullname[fullname]
      }
    }
  },

  _showInfo: function(tabId, info) {
    chrome.tabs.sendRequest(tabId, {action:'showInfo', info:info, loggedIn:redditInfo.isLoggedIn()})
  },

  updateOverlay: function(info) {
    if (this.fullname[info.name]) {
      this.fullname[info.name].forEach(function(tabId) {
        console.log("Sending show overlay command for", info)
        tabStatus._showInfo(tabId, info)
      })
    }
  },

  updateTab: function(tabId) {
    var fullname = tabStatus.tabId[tabId]
    if (fullname && fullname !== true) {
      redditInfo.lookupNameStored(fullname, function(info) {
        console.log("Updating tab", tabId)
        tabStatus._showInfo(tabId, info)
      })
    }
  },

  showSubmitOverlay: function(tabId) {
   chrome.tabs.sendRequest(tabId, {action:'showSubmit'})
  },
  
  tabId: {},
  fullname: {}
}

function addContent(tab, pieces, callback) {
  var piece = pieces.shift()
  if (piece) {
    console.log('Injecting', piece)
    if (piece.type == 'js') {
      var inject = chrome.tabs.executeScript
    } else if (piece.type == 'css') {
      var inject = chrome.tabs.insertCSS
    }
    delete piece.type
    
    inject(tab.id, piece, function() {
      addContent(tab, pieces, callback)
    })
  } else {
    if (callback) { callback() }
  }
}

function addOverlayContent(tab, callback) {
  addContent(tab, [{type:'js',  file:'jquery-1.4.2.min.js'},
                   {type:'css', file:'pageOverlay.css'},
                   {type:'js',  file:'pageOverlay.js'}], callback)
}

function ensureOverlay(tab, callback) {
  if (!tabStatus.tabId[tab.id]) {
    addOverlayContent(tab, function() {
      callback()
    })
  } else {
    callback()
  }
}

function addBarOverlay(tab, info) {
  ensureOverlay(tab, function() {
    tabStatus.set(tab.id, info.name)
    tabStatus.updateOverlay(info)
  })
}

function setPageActionIcon(tab) {
  if (/^http:\/\/.*/.test(tab.url)) {
    var info = redditInfo.url[tab.url]
    if (info) {
      chrome.pageAction.setIcon({tabId:tab.id, path:'/images/reddit.png'})
    } else { 
      chrome.pageAction.setIcon({tabId:tab.id, path:'/images/reddit-inactive.png'})
    }
    chrome.pageAction.show(tab.id)
    return info
  }
}

function onTabLoad(tab) {
  var info = setPageActionIcon(tab)
  if (info) {
    console.log('Recognized page '+tab.url, info)
    addBarOverlay(tab, info)
  }
}

function onActionClicked(tab) {
  var frame = 0
  var workingAnimation = window.setInterval(function() {
    try {
      chrome.pageAction.setIcon({tabId:tab.id, path:'/images/working'+frame+'.png'})
    } catch (exc) {
      window.clearInterval(arguments.callee)
    }
    frame = (frame + 1) % 6
  }, 200)
  
  redditInfo.lookupURLStored(tab.url, function(info) {
    window.clearInterval(workingAnimation)
    setPageActionIcon(tab)
    
    if (info) {
      addBarOverlay(tab, info)
    } else {
      ensureOverlay(tab, function() {
        tabStatus.set(tab.id)
        tabStatus.showSubmitOverlay(tab.id)
      })
    }
  })
}

function onRequest(request, sender, callback) {
  switch (request.action) {
    case 'thingClick':
      console.log('Thing clicked', request)
      redditInfo.setURL(request.url, request.info)
      break
    case 'modhashUpdate':
      console.log('Scraped modhash', request)
      redditInfo.storeModhash(request.modhash)
      break
    case 'query':
      if (request.hasOwnProperty('url')) {
        callback(redditInfo.url[request.url])
      } else if (request.hasOwnProperty('fullname')) {
        callback(redditInfo.fullname[request.fullname])
      }
      break
    case 'vote':
      console.log('Voting', request)
      redditInfo.vote(request.fullname, request.likes, callback)
      break
    case 'save':
    case 'unsave':
      console.log('Modifying', request)
      redditInfo[request.action](request.fullname, callback)
      break
  }
}

window.setInterval(function() {
    redditInfo.checkMail()
}, 300000)

chrome.extension.onRequest.addListener(onRequest)
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
  if (changeInfo.status == 'loading') {
    tabStatus.remove(tabId)
    onTabLoad(tab)
  }
})

chrome.tabs.onSelectionChanged.addListener(tabStatus.updateTab)

chrome.pageAction.onClicked.addListener(onActionClicked)

// Show page action for existing tabs.
chrome.windows.getAll({populate:true}, function(wins) {
  wins.forEach(function(win) {
    win.tabs.forEach(function(tab) {
      setPageActionIcon(tab)
    })
  })
})

console.log("Shine loaded.")
redditInfo.init()
redditInfo.checkMail()
