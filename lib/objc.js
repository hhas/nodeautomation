#!/usr/bin/env node

'use strict';

const objc = require('nodobjc');
objc.import('Foundation');
objc.import('AppKit'); // needed to obtain absolute paths to .app bundles given app name

// .bridgesupport XMLs no longer include 'depends_on' elements, which nodobjc uses to locate nested frameworks; as workaround, import using absolute paths to the required sub-frameworks (for AE constants and SDEF retrieval)
const path = require('path');
objc.import(path.join(objc.resolve('Carbon'), 'Frameworks/OpenScripting.framework'));
objc.import(path.join(objc.resolve('CoreServices'), 'Frameworks/AE.framework'));

module.exports = objc;


