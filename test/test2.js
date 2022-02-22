#!/usr/bin/env node

'use strict';

const {app, con, its, k, File} = require('nodeautomation');



try {

console.log(app('TextEdit', {terminology: '/Users/has/dev/javascript/nodeautomation/test/TextEdit-glue.json'}).documents.first())


} catch (e) {

console.log(e)

console.log(e.stack)

}
