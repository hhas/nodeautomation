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


console.log(ref) // TO DO: FIX: Specifiers aren't yet displaying correctly, i.e. "[Function (anonymous)]" instead of "app('TextEdit').documents.at(1)", but they are usable


//console.log()

console.log('get text:')
let text = ref.text.get()
console.log(text)


try {
	te.documents[99].get()
} catch(e) {
	console.log(e)
}
