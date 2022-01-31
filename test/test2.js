#!/usr/bin/env node

'use strict';

const na = require('./lib');
const aesupport = na.__aesupport;

const app = na.app, con = na.con, its = na.its, k = na.k, File = na.File;

// TO DO: autorelease pools not yet implemented in NodeAutomation, so will leak unless user provides their own



console.log(k, k.document, k.fromTypeCode("#docu")[aesupport.__packSelf](), k.fromTypeCode(0x75747874))


var v = k.documentFile;
console.log(k.documentFile.isEqual(v),k.documentfile.isEqual(v));


var file = new File('/Users/jsmith/Documents');
console.log(file, String(file), new File('/Users/jsmith/Documents').isEqual(file), new File('/').isEqual(file));
