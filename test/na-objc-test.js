#!/usr/bin/env node 
//--prof

const na = require('nodeautomation')

var te = na.app('TextEdit', {terminology: __dirname+'/TextEdit-glue.json'})

//for (var i=0; i<100; i++) {
//try {
//console.log(te.name)//.get()
//} catch (e) {
//}
//}

te.activate()

const ref = te.make({new: na.k.document, withProperties: {text: "Hello, World!"}})

console.log(ref)

console.log(ref.text.get())
