#!/usr/bin/env node 

// Reminders uses XInclude to import its Standard Suite definitions from CocoaScripting framework, so check those terms are present

const na = require('nodeautomation')

const rm = na.app('Reminders')



rm.activate()

console.log(rm.windows.properties())
