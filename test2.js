#!/usr/bin/env node

'use strict';

const na = require('./lib');

const app = na.app, con = na.con, its = na.its, k = na.k, File = na.File;

// TO DO: autorelease pools not yet implemented in NodeAutomation, so will leak unless user provides their own



console.log(k, k.document, k.fromTypeCode("#docu").__nodeautomation_pack__(), k.fromTypeCode(0x75747874))
