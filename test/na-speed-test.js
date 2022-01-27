#!/usr/bin/env node 

const na = require('nodeautomation')


let t = process.hrtime.bigint()

async function test(skipSDEF) {

	var te = na.app('TextEdit', skipSDEF ? {terminology: __dirname+'/TextEdit-glue.json'} : {}) // SDEF parsing is now 15sec instead of >5mins, which is an improvement but still dog-slow; if we can't get the NSXML parser doing a decent speed then one option is to rewrite it using a native JS XML parser that has XInclude support (typically lxml-based), as py3-appscript does


	te.activate()

	//te.make({new: na.k.document, withProperties: {text: "Hello, World!"}})

	console.log('time: '+(Number(process.hrtime.bigint() - t)/1e9)+'sec')

	await new Promise(resolve => setTimeout(resolve, 1000));

	te.quit()

	console.log('success!')

}

test(true)
