#!/usr/bin/env node 

// Reminders uses XInclude to import its Standard Suite definitions from CocoaScripting framework, so check those terms are present

const na = require('nodeautomation')

const rm = na.app('Reminders')



rm.activate()

console.log(rm.windows.properties())


// TEST

//exportRawTerminology('/Applications/Adobe InDesign CS6/Adobe InDesign CS6.app', '/Users/has/InDesign.json');


/*

const url = objc.NSURL.fileURLWithPath_('/Applications/TextEdit.app');

//const p = new SDEFParser(); p.parse(getScriptingDefinition(url)); console.log(require('util').inspect(p));

const p = new GlueTable(); p.addSDEFAtURL(url); console.log(p);



exportRawTerminology('/Applications/TextEdit.app', '/Users/has/TextEdit.node.json');

console.log(exportRawTerminology('/Applications/TextEdit.app'));

*/
