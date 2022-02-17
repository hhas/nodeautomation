#!/usr/bin/env node 
//--prof

const na = require('nodeautomation')

const te = na.app('TextEdit', {terminology: __dirname+'/TextEdit-glue.json'})


const objc = require('objc')


let ref;

//for (var i=0; i<100; i++) {
//try {
//console.log(te.name)//.get()
//} catch (e) {
//}
//}

te.activate()

ref = te.documents[0]

ref = te.make({new: na.k.document, withProperties: {text: "Hello, World!"}})


//console.log('ref: (type='+typeof ref+')') // ref: (type=function)


console.log(ref) // e.g. app('TextEdit').documents.named('Untitled 1')


//console.log()

let text = ref.text.get()
console.log('get text:', text) // Hello, World!


try {
	te.documents[99].get()
} catch(e) {
	console.log(e, '\n') // CommandError (-1719): Can't get reference. Invalid index.
}

