'use strict';

var level     = require('level-test')()
var sublevel  = require('level-sublevel/bytewise')
var pull      = require('pull-stream')
var tape      = require('tape')

var Abortable = require('pull-abortable')

var SSB       = require('../')

var compare   = require('ltgt').compare

//create a instance with a feed
//then have another instance follow it.

function rand (n) {
  var a = []
  while(n--)
    a.push(Math.random())
  return a
}

function sort (ary) {
  return ary.sort(function (a, b) {
    return compare(a.id, b.id) || a.sequence - b.sequence
  })
}


module.exports = function (opts) {

  var create = require('ssb-feed/message')(opts)

  function createDB(name) {
    return SSB(sublevel(level(name, {
      valueEncoding: opts.codec
    })), opts)
  }

  var MESSAGE = new Buffer('msg')

  function init (ssb, n, cb) {
    var keys = opts.keys.generate()
    var prev

    ssb.add(prev = create(keys, null, {type: 'init', public: keys.public}), function () {
      pull(
        pull.values(rand(n)),
        pull.asyncMap(function (r, cb) {
          ssb.add(prev =
            create(keys, 'msg', ''+r, prev), cb)
        }),
        pull.drain(null, cb)
      )
    })

    return keys
  }

  var ssb = createDB('ssb-history')
  var keys, id, keys2, id2
  tape('history', function (t) {

    keys = init(ssb, 7, function (err) {
      if(err) throw err
      pull(ssb.latest(), pull.collect(function (err, ary) {
        if(err) throw err
        console.log(ary)
        t.deepEqual(ary, [
          {id: keys.id, sequence: 8}
        ])
        t.end()
      }))
    })

    id = keys.id //opts.hash(keys.public)
  })

  tape('since', function (t) {
    pull(
      ssb.createHistoryStream(id, 1),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 8)
        t.end()
      })
    )
  })

  tape('two keys', function (t) {

    keys2 = init(ssb, 4, function (err) {
      pull(ssb.latest(), pull.collect(function (err, ary) {
        if(err) throw err
        t.deepEqual(sort(ary), sort([
          {id: keys.id, sequence: 8},
          {id: keys2.id, sequence: 5}
        ]))
        t.end()
      }))
    })

  })

  tape('keys & since', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, seq: 1, keys: true }),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 8)
        t.ok(!!ary[0].key)
        t.ok(!!ary[1].key)
        t.end()
      })
    )
  })

  tape('user stream', function (t) {
    pull(
      ssb.createUserStream({id: id, gt: 3, lte: 7, reverse: true}),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 4)
        t.equal(ary[3].value.sequence, 4)
        t.equal(ary[2].value.sequence, 5)
        t.equal(ary[1].value.sequence, 6)
        t.equal(ary[0].value.sequence, 7)
        t.end()
      })
    )
  })

  tape('keys only', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, values: false }),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 8)
        ary.forEach(function (v) { t.equal(typeof v, 'string') })
        t.end()
      })
    )
  })

  tape('values only', function (t) {
    pull(
      ssb.createHistoryStream({ id: id, keys: false }),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 8)
        ary.forEach(function (v) { t.equal(typeof v.content.type, 'string') })
        t.end()
      })
    )
  })

  tape('abort live stream', function (t) {
    var abortable = Abortable(), err = new Error('intentional'), i = 0

    pull(
      ssb.createHistoryStream({
        id: id, keys: false, live: true,
        onAbort: function (_err) {
          t.equal(_err, err)
          t.end()
        }
      }),
      abortable,
      pull.through(function (data) {
        if(++i == 8)
          setTimeout(function () {
            abortable.abort(err)
          }, 100)
        console.log(data)
      }),
      pull.collect(function (err, ary) {
        t.equal(ary.length, 8)
      })
    )


  })
}

if(!module.parent)
  module.exports(require('../defaults'))
