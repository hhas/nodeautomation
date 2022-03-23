#!/usr/bin/env node 

const na = require('nodeautomation')



async function test(skipSDEF) {

	let t = process.hrtime.bigint()

	var te = na.app('TextEdit', skipSDEF ? {terminology: __dirname+'/TextEdit-glue.json'} : {}) // SDEF parsing now takes 15sec instead of >5mins, which is an improvement but is still dog-slow; if we can't get the NSXML parser doing a decent speed then one option is to rewrite it using a native JS XML parser that has XInclude support (typically lxml-based), as py3-appscript now does

	te.activate()


	let d = te.make({new: na.k.document, withProperties: {text: "Hello, World!"}})

//	await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1 sec

//	te.quit()

	console.log('time: '+(Number(process.hrtime.bigint() - t)/1e9)+'sec')
	
	console.log(d)

}

test(true) // true = use TextEdit glue; in which case entire test takes ~2.6sec (with 1.0sec of that being the sleep in middle, and most of the rest being startup overheads as objc and nodeautomation caches warm up)
